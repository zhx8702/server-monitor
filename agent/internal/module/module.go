package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/config"
)

// Module is the base interface that all monitoring modules must implement.
type Module interface {
	// Name returns the unique module identifier (e.g. "cpu", "docker").
	Name() string
	// Init initializes the module with the global configuration.
	Init(cfg *config.Config) error
	// Routes returns the HTTP routes this module exposes.
	Routes() []Route
	// Close releases any resources held by the module.
	Close() error
}

// PeriodicModule extends Module with periodic data collection and history.
type PeriodicModule interface {
	Module
	// Collect performs one collection cycle, storing results internally.
	Collect() error
	// Interval returns the collection interval (0 = use global default).
	Interval() time.Duration
}

// Route describes a single HTTP route registered by a module.
type Route struct {
	Method  string           // "GET", "POST", etc.
	Path    string           // "/api/docker"
	Handler http.HandlerFunc // The handler function
}
