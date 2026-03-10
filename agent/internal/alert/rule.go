package alert

import (
	"fmt"
	"os"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// AlertRule defines a threshold-based alert rule.
type AlertRule struct {
	ID         string  `yaml:"id" json:"id"`
	Name       string  `yaml:"name" json:"name"`
	Metric     string  `yaml:"metric" json:"metric"`             // "memory_usage","disk_usage","load_1","load_5","load_15"
	Operator   string  `yaml:"operator" json:"operator"`          // ">","<",">=","<="
	Threshold  float64 `yaml:"threshold" json:"threshold"`
	Duration   int     `yaml:"duration" json:"duration"`          // seconds condition must persist (0=immediate)
	Severity   string  `yaml:"severity" json:"severity"`          // "critical","warning","info"
	Enabled    bool    `yaml:"enabled" json:"enabled"`
	MountPoint string  `yaml:"mount_point,omitempty" json:"mountPoint,omitempty"` // only for disk_usage
}

// NotifyChannel describes a notification target.
type NotifyChannel struct {
	ID      string `yaml:"id" json:"id"`
	Name    string `yaml:"name" json:"name"`
	Type    string `yaml:"type" json:"type"` // "webhook"
	URL     string `yaml:"url" json:"url"`
	Enabled bool   `yaml:"enabled" json:"enabled"`
}

// AlertEvent records when an alert fires or resolves.
type AlertEvent struct {
	RuleID     string     `json:"ruleId"`
	RuleName   string     `json:"ruleName"`
	Metric     string     `json:"metric"`
	Value      float64    `json:"value"`
	Threshold  float64    `json:"threshold"`
	Severity   string     `json:"severity"`
	Status     string     `json:"status"` // "firing","resolved"
	FiredAt    time.Time  `json:"firedAt"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
}

// alertConfig is the on-disk YAML structure.
type alertConfig struct {
	Rules    []AlertRule    `yaml:"rules"`
	Channels []NotifyChannel `yaml:"channels"`
}

// ConfigStore handles reading and writing alert configuration to a YAML file.
type ConfigStore struct {
	mu   sync.Mutex
	path string
}

// NewConfigStore creates a store backed by the given file path.
func NewConfigStore(path string) *ConfigStore {
	return &ConfigStore{path: path}
}

// Load reads rules and channels from the YAML file.
// Returns empty slices if the file doesn't exist.
func (s *ConfigStore) Load() ([]AlertRule, []NotifyChannel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("read %s: %w", s.path, err)
	}

	var cfg alertConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, nil, fmt.Errorf("parse %s: %w", s.path, err)
	}
	return cfg.Rules, cfg.Channels, nil
}

// Save writes the current rules and channels to the YAML file.
func (s *ConfigStore) Save(rules []AlertRule, channels []NotifyChannel) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg := alertConfig{
		Rules:    rules,
		Channels: channels,
	}

	data, err := yaml.Marshal(&cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	if err := os.WriteFile(s.path, data, 0644); err != nil {
		return fmt.Errorf("write %s: %w", s.path, err)
	}
	return nil
}

// CheckCondition evaluates "value operator threshold".
func CheckCondition(value float64, operator string, threshold float64) bool {
	switch operator {
	case ">":
		return value > threshold
	case ">=":
		return value >= threshold
	case "<":
		return value < threshold
	case "<=":
		return value <= threshold
	default:
		return false
	}
}

// ValidMetrics lists the supported metric keys.
var ValidMetrics = map[string]bool{
	"memory_usage": true,
	"disk_usage":   true,
	"load_1":       true,
	"load_5":       true,
	"load_15":      true,
}
