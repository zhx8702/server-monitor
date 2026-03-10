// sm-plugin-demo is a minimal reference implementation of a server-monitor plugin.
// It demonstrates the plugin contract:
//   - Accept --socket and --config flags
//   - Listen on a Unix socket
//   - Expose /health, and custom business routes
//
// Build: go build -o sm-plugin-demo .
// The agent starts this binary automatically when installed.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"
)

func main() {
	sockPath := flag.String("socket", "", "Unix socket path to listen on")
	cfgJSON := flag.String("config", "{}", "JSON-encoded plugin configuration")
	flag.Parse()

	if *sockPath == "" {
		log.Fatal("--socket is required")
	}

	// Parse config
	var cfg map[string]string
	if err := json.Unmarshal([]byte(*cfgJSON), &cfg); err != nil {
		log.Printf("Warning: cannot parse config: %v", err)
		cfg = make(map[string]string)
	}

	log.Printf("sm-plugin-demo starting (socket=%s, config=%v)", *sockPath, cfg)

	// Remove stale socket
	os.Remove(*sockPath)

	listener, err := net.Listen("unix", *sockPath)
	if err != nil {
		log.Fatalf("Cannot listen on %s: %v", *sockPath, err)
	}
	defer listener.Close()

	startTime := time.Now()

	mux := http.NewServeMux()

	// Required: /health endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Business route: GET /api/demo
	mux.HandleFunc("/api/demo", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"plugin":  "demo",
			"version": "1.0.0",
			"uptime":  int64(time.Since(startTime).Seconds()),
			"runtime": map[string]any{
				"os":           runtime.GOOS,
				"arch":         runtime.GOARCH,
				"goVersion":    runtime.Version(),
				"goroutines":   runtime.NumGoroutine(),
				"cpuCount":     runtime.NumCPU(),
			},
			"config":  cfg,
			"message": "Hello from the demo plugin!",
		})
	})

	server := &http.Server{Handler: mux}

	// Graceful shutdown on SIGTERM
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		log.Printf("sm-plugin-demo received %v, shutting down...", sig)
		server.Close()
	}()

	log.Printf("sm-plugin-demo listening on %s", *sockPath)
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}

	fmt.Println("sm-plugin-demo stopped.")
}
