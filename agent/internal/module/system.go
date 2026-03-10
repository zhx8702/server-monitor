package module

import (
	"net/http"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
)

func init() {
	Register("system", func() Module { return &SystemModule{} })
}

// SystemModule wraps SystemCollector as a Module.
type SystemModule struct {
	collector *collector.SystemCollector
}

func (m *SystemModule) Name() string                  { return "system" }
func (m *SystemModule) Init(_ *config.Config) error    { m.collector = collector.NewSystemCollector(); return nil }
func (m *SystemModule) Close() error                   { return nil }

func (m *SystemModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/system", Handler: m.handleGet},
	}
}

func (m *SystemModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	info, err := m.collector.Collect()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to collect system info: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}
