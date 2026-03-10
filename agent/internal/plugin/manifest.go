package plugin

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Manifest describes a plugin's metadata and capabilities.
type Manifest struct {
	Name            string        `yaml:"name" json:"name"`
	Version         string        `yaml:"version" json:"version"`
	Description     string        `yaml:"description" json:"description"`
	Author          string        `yaml:"author" json:"author"`
	MinAgentVersion string        `yaml:"min_agent_version" json:"minAgentVersion,omitempty"`
	Source          string        `yaml:"source" json:"source,omitempty"`
	Type            string        `yaml:"type" json:"type"`                 // "on-demand" or "periodic"
	Interval        int           `yaml:"interval" json:"interval"`         // seconds, 0 = global default
	Binary          string        `yaml:"binary" json:"binary"`             // binary filename
	Routes          []RouteSpec   `yaml:"routes" json:"routes"`
}

// RouteSpec describes an HTTP route the plugin exposes.
type RouteSpec struct {
	Method string `yaml:"method" json:"method"`
	Path   string `yaml:"path" json:"path"`
}

// LoadManifest reads a plugin.yaml from the given plugin directory.
func LoadManifest(pluginDir string) (*Manifest, error) {
	path := filepath.Join(pluginDir, "plugin.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var m Manifest
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	if m.Name == "" {
		return nil, fmt.Errorf("%s: name is required", path)
	}
	if m.Binary == "" {
		m.Binary = "sm-plugin-" + m.Name
	}
	if m.Type == "" {
		m.Type = "on-demand"
	}

	return &m, nil
}

// BinaryPath returns the absolute path to the plugin binary.
func (m *Manifest) BinaryPath(pluginDir string) string {
	return filepath.Join(pluginDir, m.Name, m.Binary)
}
