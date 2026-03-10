package module

import (
	"net/http"
	"strconv"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
)

func init() {
	Register("processes", func() Module { return &ProcessModule{} })
}

// ProcessModule wraps ProcessCollector as a Module.
type ProcessModule struct {
	collector *collector.ProcessCollector
}

func (m *ProcessModule) Name() string                  { return "processes" }
func (m *ProcessModule) Init(_ *config.Config) error    { m.collector = collector.NewProcessCollector(); return nil }
func (m *ProcessModule) Close() error                   { return nil }

func (m *ProcessModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/processes", Handler: m.handleGet},
	}
}

func (m *ProcessModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	sortBy := r.URL.Query().Get("sort")
	if sortBy == "" {
		sortBy = "cpu"
	}
	order := r.URL.Query().Get("order")
	if order == "" {
		order = "desc"
	}
	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}

	snap, err := m.collector.CollectSorted(sortBy, order, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to collect process info: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
