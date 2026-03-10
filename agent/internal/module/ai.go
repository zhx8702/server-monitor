package module

import (
	"github.com/server-monitor/agent/internal/config"
)

func init() {
	Register("ai", func() Module { return &AIModule{} })
}

// AIModule is a placeholder module for the AI assistant.
// The actual AI chat handler is registered directly in main.go
// using the headless CLI runner.
type AIModule struct{}

func (m *AIModule) Name() string               { return "ai" }
func (m *AIModule) Init(_ *config.Config) error { return nil }
func (m *AIModule) Close() error                { return nil }
func (m *AIModule) Routes() []Route             { return nil }
