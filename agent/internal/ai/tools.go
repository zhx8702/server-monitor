package ai

import (
	"fmt"
	"sync"
)

// ToolFunc is the Go function that executes a tool call.
// It receives the JSON arguments string and returns a result string.
type ToolFunc func(argsJSON string) (string, error)

// ToolRegistry holds all registered tools and their executor functions.
type ToolRegistry struct {
	mu    sync.RWMutex
	defs  []ToolDef
	funcs map[string]ToolFunc
}

// NewToolRegistry creates a new empty tool registry.
func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{
		funcs: make(map[string]ToolFunc),
	}
}

// Register adds a tool definition and its executor function to the registry.
func (r *ToolRegistry) Register(def ToolDef, fn ToolFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.defs = append(r.defs, def)
	r.funcs[def.Function.Name] = fn
}

// Definitions returns all registered tool definitions.
func (r *ToolRegistry) Definitions() []ToolDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ToolDef, len(r.defs))
	copy(out, r.defs)
	return out
}

// Execute runs a tool by name with the given JSON arguments.
func (r *ToolRegistry) Execute(name, argsJSON string) (string, error) {
	r.mu.RLock()
	fn, ok := r.funcs[name]
	r.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("unknown tool: %s", name)
	}
	return fn(argsJSON)
}
