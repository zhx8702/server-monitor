package config

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// ModuleConfig holds per-module configuration.
type ModuleConfig struct {
	Enabled bool              `yaml:"enabled"`
	Options map[string]string `yaml:"options,omitempty"`
}

// PluginConfig holds plugin system configuration.
type PluginConfig struct {
	Dir    string   `yaml:"dir"`
	Stores []string `yaml:"stores,omitempty"`
}

// Config holds all configuration values for the agent.
type Config struct {
	Port            int                     `yaml:"port"`
	AuthToken       string                  `yaml:"-"` // only from environment
	CollectInterval int                     `yaml:"collect_interval"`
	HistoryDuration int                     `yaml:"history_duration"`
	AlertsConfig    string                  `yaml:"alerts_config"`  // path to alerts.yaml
	GitHubRepo      string                  `yaml:"github_repo"`    // e.g. "user/server-monitor"
	Plugins         PluginConfig            `yaml:"plugins"`
	Modules         map[string]ModuleConfig `yaml:"modules"`
}

// LoadConfig reads configuration from YAML file (if exists), then applies
// environment variable overrides. SM_TOKEN is always required via env.
func LoadConfig() (*Config, error) {
	cfg := &Config{
		Port:            9090,
		CollectInterval: 2,
		HistoryDuration: 600,
		Modules:         make(map[string]ModuleConfig),
	}

	// Load YAML config file if available
	configPath := os.Getenv("SM_CONFIG")
	if configPath == "" {
		configPath = "/etc/server-monitor-agent.yaml"
	}
	if data, err := os.ReadFile(configPath); err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse config file %s: %w", configPath, err)
		}
		if cfg.Modules == nil {
			cfg.Modules = make(map[string]ModuleConfig)
		}
	}

	// Environment variable overrides
	if v := os.Getenv("SM_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid SM_PORT value %q: %w", v, err)
		}
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("SM_PORT must be between 1 and 65535, got %d", port)
		}
		cfg.Port = port
	}

	cfg.AuthToken = os.Getenv("SM_TOKEN")
	if cfg.AuthToken == "" {
		return nil, fmt.Errorf("SM_TOKEN environment variable is required")
	}

	if v := os.Getenv("SM_COLLECT_INTERVAL"); v != "" {
		interval, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid SM_COLLECT_INTERVAL value %q: %w", v, err)
		}
		if interval < 1 {
			return nil, fmt.Errorf("SM_COLLECT_INTERVAL must be >= 1, got %d", interval)
		}
		cfg.CollectInterval = interval
	}

	if v := os.Getenv("SM_HISTORY_DURATION"); v != "" {
		duration, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid SM_HISTORY_DURATION value %q: %w", v, err)
		}
		if duration < 1 {
			return nil, fmt.Errorf("SM_HISTORY_DURATION must be >= 1, got %d", duration)
		}
		cfg.HistoryDuration = duration
	}

	// Alerts config path
	if cfg.AlertsConfig == "" {
		cfg.AlertsConfig = "/etc/server-monitor/alerts.yaml"
	}
	if v := os.Getenv("SM_ALERTS_CONFIG"); v != "" {
		cfg.AlertsConfig = v
	}

	// GitHub repo for auto-update
	if v := os.Getenv("SM_GITHUB_REPO"); v != "" {
		cfg.GitHubRepo = v
	}

	// Plugin directory
	if cfg.Plugins.Dir == "" {
		cfg.Plugins.Dir = "/etc/server-monitor/plugins"
	}
	if v := os.Getenv("SM_PLUGIN_DIR"); v != "" {
		cfg.Plugins.Dir = v
	}

	// Backward compat: SM_DOCKER_SOCKET → modules.docker.options.socket
	if v := os.Getenv("SM_DOCKER_SOCKET"); v != "" {
		dc := cfg.Modules["docker"]
		dc.Enabled = true
		if dc.Options == nil {
			dc.Options = make(map[string]string)
		}
		dc.Options["socket"] = v
		cfg.Modules["docker"] = dc
	}

	return cfg, nil
}

// ModuleOption returns an option value for a module, or the fallback if not set.
func (c *Config) ModuleOption(module, key, fallback string) string {
	if mc, ok := c.Modules[module]; ok {
		if v, ok := mc.Options[key]; ok && v != "" {
			return v
		}
	}
	return fallback
}
