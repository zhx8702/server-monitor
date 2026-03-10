package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/history"
)

func init() {
	Register("loadavg", func() Module { return &LoadAvgModule{} })
}

// LoadAvgModule wraps LoadAvgCollector with a ring buffer.
type LoadAvgModule struct {
	collector *collector.LoadAvgCollector
	history   *history.RingBuffer[collector.LoadAvg]
}

func (m *LoadAvgModule) Name() string { return "loadavg" }

func (m *LoadAvgModule) Init(cfg *config.Config) error {
	m.collector = collector.NewLoadAvgCollector()
	m.history = history.NewRingBuffer[collector.LoadAvg](cfg.HistoryDuration, cfg.CollectInterval)
	return nil
}

func (m *LoadAvgModule) Close() error        { return nil }
func (m *LoadAvgModule) Interval() time.Duration { return 0 }

func (m *LoadAvgModule) Collect() error {
	snap, err := m.collector.Collect()
	if err != nil {
		return err
	}
	m.history.Push(*snap)
	return nil
}

func (m *LoadAvgModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/loadavg", Handler: m.handleGet},
	}
}

type loadAvgResponse struct {
	*collector.LoadAvg
	History []history.Entry[collector.LoadAvg] `json:"history,omitempty"`
}

func (m *LoadAvgModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entry, ok := m.history.Latest()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "no load average data available yet")
		return
	}

	resp := loadAvgResponse{LoadAvg: &entry.Data}

	if r.URL.Query().Get("history") == "true" {
		resp.History = getHistory(m.history, r.URL.Query().Get("duration"))
	}

	writeJSON(w, http.StatusOK, resp)
}
