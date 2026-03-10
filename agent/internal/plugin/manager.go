package plugin

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/module"
)

// Ensure ExternalModule satisfies module.Module at compile time.
var _ module.Module = (*ExternalModule)(nil)

// Manager manages external plugin lifecycle.
type Manager struct {
	mu        sync.Mutex
	pluginDir string
	socketDir string
	cfg       *config.Config
	running   map[string]*RunningPlugin
}

// RunningPlugin tracks a running external plugin.
type RunningPlugin struct {
	Manifest Manifest
	Module   *ExternalModule
}

// NewManager creates a plugin manager.
func NewManager(cfg *config.Config) *Manager {
	socketDir := filepath.Join(cfg.Plugins.Dir, ".sockets")
	return &Manager{
		pluginDir: cfg.Plugins.Dir,
		socketDir: socketDir,
		cfg:       cfg,
		running:   make(map[string]*RunningPlugin),
	}
}

// ScanAndStart discovers installed plugins and starts enabled ones.
// Returns the loaded modules to be merged with built-in modules.
func (m *Manager) ScanAndStart() []module.Module {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ensure directories exist
	if err := os.MkdirAll(m.socketDir, 0755); err != nil {
		log.Printf("Plugin: cannot create socket dir %s: %v", m.socketDir, err)
		return nil
	}

	entries, err := os.ReadDir(m.pluginDir)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Plugin: directory %s not found, skipping", m.pluginDir)
			return nil
		}
		log.Printf("Plugin: cannot read dir %s: %v", m.pluginDir, err)
		return nil
	}

	var modules []module.Module
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == ".sockets" {
			continue
		}

		pluginSubDir := filepath.Join(m.pluginDir, entry.Name())
		manifest, err := LoadManifest(pluginSubDir)
		if err != nil {
			log.Printf("Plugin: skip %s: %v", entry.Name(), err)
			continue
		}

		// Check if module is disabled in config
		if modCfg, ok := m.cfg.Modules[manifest.Name]; ok && !modCfg.Enabled {
			log.Printf("Plugin %q disabled by config", manifest.Name)
			continue
		}

		// Check binary exists
		binPath := manifest.BinaryPath(m.pluginDir)
		if _, err := os.Stat(binPath); err != nil {
			log.Printf("Plugin: skip %s: binary not found at %s", manifest.Name, binPath)
			continue
		}

		// Get plugin-specific options from config
		var options map[string]string
		if modCfg, ok := m.cfg.Modules[manifest.Name]; ok {
			options = modCfg.Options
		}

		sockPath := filepath.Join(m.socketDir, manifest.Name+".sock")
		ext := NewExternalModule(*manifest, m.pluginDir, sockPath, options)

		if err := ext.Init(m.cfg); err != nil {
			log.Printf("Plugin %q failed to start: %v", manifest.Name, err)
			continue
		}

		m.running[manifest.Name] = &RunningPlugin{
			Manifest: *manifest,
			Module:   ext,
		}
		modules = append(modules, ext)
		log.Printf("Plugin %q v%s loaded", manifest.Name, manifest.Version)
	}

	return modules
}

// StopAll gracefully stops all running plugins.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, rp := range m.running {
		log.Printf("Stopping plugin %s...", name)
		rp.Module.Close()
		delete(m.running, name)
	}
}

// InstalledPlugins returns manifests of all installed plugins with their status.
func (m *Manager) InstalledPlugins() []PluginStatus {
	m.mu.Lock()
	defer m.mu.Unlock()

	var result []PluginStatus

	entries, err := os.ReadDir(m.pluginDir)
	if err != nil {
		return result
	}

	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == ".sockets" {
			continue
		}
		pluginSubDir := filepath.Join(m.pluginDir, entry.Name())
		manifest, err := LoadManifest(pluginSubDir)
		if err != nil {
			continue
		}

		status := "stopped"
		if rp, ok := m.running[manifest.Name]; ok && rp.Module.IsRunning() {
			status = "running"
		}

		result = append(result, PluginStatus{
			Name:        manifest.Name,
			Version:     manifest.Version,
			Description: manifest.Description,
			Author:      manifest.Author,
			Source:       manifest.Source,
			Status:      status,
		})
	}

	return result
}

// Install downloads and installs a plugin from a store.
func (m *Manager) Install(store *Store, name, version string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	pluginSubDir := filepath.Join(m.pluginDir, name)
	if err := os.MkdirAll(pluginSubDir, 0755); err != nil {
		return fmt.Errorf("create plugin dir: %w", err)
	}

	if err := store.Download(name, version, pluginSubDir); err != nil {
		os.RemoveAll(pluginSubDir)
		return fmt.Errorf("download plugin: %w", err)
	}

	log.Printf("Plugin %s v%s installed to %s", name, version, pluginSubDir)
	return nil
}

// Uninstall stops and removes a plugin.
func (m *Manager) Uninstall(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop if running
	if rp, ok := m.running[name]; ok {
		rp.Module.Close()
		delete(m.running, name)
	}

	pluginSubDir := filepath.Join(m.pluginDir, name)
	if err := os.RemoveAll(pluginSubDir); err != nil {
		return fmt.Errorf("remove plugin dir: %w", err)
	}

	// Clean up socket
	os.Remove(filepath.Join(m.socketDir, name+".sock"))

	log.Printf("Plugin %s uninstalled", name)
	return nil
}

// PluginStatus holds plugin info for API responses.
type PluginStatus struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description,omitempty"`
	Author      string `json:"author,omitempty"`
	Source      string `json:"source,omitempty"`
	Status      string `json:"status"` // "running", "stopped"
}
