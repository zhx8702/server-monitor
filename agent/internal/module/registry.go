package module

import (
	"log"
	"sort"
	"sync"

	"github.com/server-monitor/agent/internal/config"
)

var (
	registryMu sync.Mutex
	registry   = map[string]func() Module{}
)

// Register is called by each module's init() to register its factory.
func Register(name string, factory func() Module) {
	registryMu.Lock()
	defer registryMu.Unlock()
	if _, exists := registry[name]; exists {
		log.Fatalf("module %q already registered", name)
	}
	registry[name] = factory
}

// EnabledModules returns instantiated and initialized modules based on config.
// Modules not mentioned in config are enabled by default.
func EnabledModules(cfg *config.Config) []Module {
	registryMu.Lock()
	defer registryMu.Unlock()

	// Sort names for deterministic ordering
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)

	var modules []Module
	for _, name := range names {
		// Check if module is disabled in config
		if modCfg, ok := cfg.Modules[name]; ok && !modCfg.Enabled {
			log.Printf("Module %q disabled by config", name)
			continue
		}

		factory := registry[name]
		m := factory()
		if err := m.Init(cfg); err != nil {
			log.Printf("Module %q init failed: %v (skipped)", name, err)
			continue
		}
		modules = append(modules, m)
		log.Printf("Module %q loaded", name)
	}

	return modules
}

// RegisteredNames returns the names of all registered modules.
func RegisteredNames() []string {
	registryMu.Lock()
	defer registryMu.Unlock()

	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
