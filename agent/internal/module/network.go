package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/history"
)

func init() {
	Register("network", func() Module { return &NetworkModule{} })
}

// NetworkModule wraps NetworkCollector with a ring buffer.
type NetworkModule struct {
	collector *collector.NetworkCollector
	history   *history.RingBuffer[collector.NetworkSnapshot]
}

func (m *NetworkModule) Name() string { return "network" }

func (m *NetworkModule) Init(cfg *config.Config) error {
	m.collector = collector.NewNetworkCollector()
	m.history = history.NewRingBuffer[collector.NetworkSnapshot](cfg.HistoryDuration, cfg.CollectInterval)
	return nil
}

func (m *NetworkModule) Close() error        { return nil }
func (m *NetworkModule) Interval() time.Duration { return 0 }

func (m *NetworkModule) Collect() error {
	snap, err := m.collector.Collect()
	if err != nil {
		return err
	}
	m.history.Push(*snap)
	return nil
}

func (m *NetworkModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/network", Handler: m.handleGet},
	}
}

type networkResponse struct {
	*collector.NetworkSnapshot
	History []history.Entry[collector.NetworkSnapshot] `json:"history,omitempty"`
}

func (m *NetworkModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entry, ok := m.history.Latest()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "no network data available yet")
		return
	}

	resp := networkResponse{NetworkSnapshot: &entry.Data}

	if r.URL.Query().Get("history") == "true" {
		resp.History = getHistory(m.history, r.URL.Query().Get("duration"))
	}

	writeJSON(w, http.StatusOK, resp)
}
