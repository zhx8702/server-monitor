package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/history"
)

func init() {
	Register("disk", func() Module { return &DiskModule{} })
}

// DiskModule wraps DiskCollector with a ring buffer for periodic collection.
type DiskModule struct {
	collector *collector.DiskCollector
	history   *history.RingBuffer[collector.DiskSnapshot]
}

func (m *DiskModule) Name() string { return "disk" }

func (m *DiskModule) Init(cfg *config.Config) error {
	m.collector = collector.NewDiskCollector()
	m.history = history.NewRingBuffer[collector.DiskSnapshot](cfg.HistoryDuration, cfg.CollectInterval)
	return nil
}

func (m *DiskModule) Close() error            { return nil }
func (m *DiskModule) Interval() time.Duration { return 0 }

func (m *DiskModule) Collect() error {
	snap, err := m.collector.Collect()
	if err != nil {
		return err
	}
	m.history.Push(*snap)
	return nil
}

func (m *DiskModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/disk", Handler: m.handleGet},
	}
}

type diskResponse struct {
	*collector.DiskSnapshot
	History []history.Entry[collector.DiskSnapshot] `json:"history,omitempty"`
}

func (m *DiskModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entry, ok := m.history.Latest()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "no disk data available yet")
		return
	}

	resp := diskResponse{DiskSnapshot: &entry.Data}

	if r.URL.Query().Get("history") == "true" {
		resp.History = getHistory(m.history, r.URL.Query().Get("duration"))
	}

	writeJSON(w, http.StatusOK, resp)
}
