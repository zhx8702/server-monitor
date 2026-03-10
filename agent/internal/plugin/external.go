package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/module"
)

// ExternalModule wraps an external plugin process as a Module.
// It starts the plugin binary, communicates via HTTP over Unix socket,
// and proxies requests from the agent's HTTP mux to the plugin.
type ExternalModule struct {
	manifest Manifest
	sockPath string
	binPath  string
	cfgJSON  string // JSON-encoded plugin options

	cmd    *exec.Cmd
	client *http.Client
	routes []module.Route
}

// NewExternalModule creates a new ExternalModule from a manifest.
func NewExternalModule(m Manifest, pluginDir, sockPath string, options map[string]string) *ExternalModule {
	cfgJSON := "{}"
	if len(options) > 0 {
		if data, err := json.Marshal(options); err == nil {
			cfgJSON = string(data)
		}
	}

	return &ExternalModule{
		manifest: m,
		sockPath: sockPath,
		binPath:  m.BinaryPath(pluginDir),
		cfgJSON:  cfgJSON,
	}
}

func (m *ExternalModule) Name() string { return m.manifest.Name }

func (m *ExternalModule) Init(_ *config.Config) error {
	// Remove stale socket
	os.Remove(m.sockPath)

	// Start plugin process
	m.cmd = exec.Command(m.binPath, "--socket", m.sockPath, "--config", m.cfgJSON)
	m.cmd.Stdout = os.Stdout
	m.cmd.Stderr = os.Stderr
	if err := m.cmd.Start(); err != nil {
		return fmt.Errorf("start plugin %s: %w", m.manifest.Name, err)
	}

	// Create HTTP client with Unix socket transport
	m.client = &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return net.DialTimeout("unix", m.sockPath, 5*time.Second)
			},
		},
		Timeout: 10 * time.Second,
	}

	// Wait for plugin to be ready
	if err := m.waitReady(10 * time.Second); err != nil {
		m.Close()
		return fmt.Errorf("plugin %s not ready: %w", m.manifest.Name, err)
	}

	// Build proxy routes from manifest
	m.routes = make([]module.Route, len(m.manifest.Routes))
	for i, rs := range m.manifest.Routes {
		m.routes[i] = module.Route{
			Method:  rs.Method,
			Path:    rs.Path,
			Handler: m.proxyHandler(rs.Path),
		}
	}

	log.Printf("Plugin %s v%s started (pid %d, %d routes)",
		m.manifest.Name, m.manifest.Version, m.cmd.Process.Pid, len(m.routes))

	return nil
}

func (m *ExternalModule) Routes() []module.Route { return m.routes }

func (m *ExternalModule) Close() error {
	if m.cmd == nil || m.cmd.Process == nil {
		return nil
	}

	// Send SIGTERM for graceful shutdown
	m.cmd.Process.Signal(syscall.SIGTERM)

	// Wait up to 5 seconds
	done := make(chan error, 1)
	go func() { done <- m.cmd.Wait() }()

	select {
	case <-done:
		// exited gracefully
	case <-time.After(5 * time.Second):
		m.cmd.Process.Kill()
		<-done
	}

	os.Remove(m.sockPath)
	log.Printf("Plugin %s stopped", m.manifest.Name)
	return nil
}

// waitReady polls the plugin's /health endpoint until it responds ok.
func (m *ExternalModule) waitReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := m.client.Get("http://plugin/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("health check timeout after %v", timeout)
}

// proxyHandler returns an HTTP handler that proxies requests to the plugin.
func (m *ExternalModule) proxyHandler(pluginPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		proxyURL := "http://plugin" + pluginPath
		proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, proxyURL, r.Body)
		if err != nil {
			writePluginError(w, http.StatusInternalServerError, "proxy request failed")
			return
		}
		proxyReq.Header = r.Header.Clone()
		proxyReq.URL.RawQuery = r.URL.RawQuery

		resp, err := m.client.Do(proxyReq)
		if err != nil {
			writePluginError(w, http.StatusBadGateway, "plugin unavailable: "+err.Error())
			return
		}
		defer resp.Body.Close()

		// Copy response
		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}

// IsRunning returns true if the plugin process is still alive.
func (m *ExternalModule) IsRunning() bool {
	if m.cmd == nil || m.cmd.Process == nil {
		return false
	}
	// On Linux, sending signal 0 checks if process exists
	return m.cmd.Process.Signal(syscall.Signal(0)) == nil
}

// writePluginError writes a JSON error response.
func writePluginError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
