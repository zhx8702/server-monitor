package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/history"
)

func init() {
	Register("memory", func() Module { return &MemoryModule{} })
}

// MemoryModule wraps MemoryCollector with a ring buffer.
type MemoryModule struct {
	collector *collector.MemoryCollector
	history   *history.RingBuffer[collector.MemorySnapshot]
}

func (m *MemoryModule) Name() string { return "memory" }

func (m *MemoryModule) Init(cfg *config.Config) error {
	m.collector = collector.NewMemoryCollector()
	m.history = history.NewRingBuffer[collector.MemorySnapshot](cfg.HistoryDuration, cfg.CollectInterval)
	return nil
}

func (m *MemoryModule) Close() error        { return nil }
func (m *MemoryModule) Interval() time.Duration { return 0 }

func (m *MemoryModule) Collect() error {
	snap, err := m.collector.Collect()
	if err != nil {
		return err
	}
	m.history.Push(*snap)
	return nil
}

func (m *MemoryModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/memory", Handler: m.handleGet},
	}
}

type memoryResponse struct {
	*collector.MemorySnapshot
	History []history.Entry[collector.MemorySnapshot] `json:"history,omitempty"`
}

func (m *MemoryModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entry, ok := m.history.Latest()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "no memory data available yet")
		return
	}

	resp := memoryResponse{MemorySnapshot: &entry.Data}

	if r.URL.Query().Get("history") == "true" {
		resp.History = getHistory(m.history, r.URL.Query().Get("duration"))
	}

	writeJSON(w, http.StatusOK, resp)
}
