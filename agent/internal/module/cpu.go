package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/history"
)

func init() {
	Register("cpu", func() Module { return &CpuModule{} })
}

// CpuModule wraps CpuCollector + LoadAvgCollector with a ring buffer.
type CpuModule struct {
	cpu     *collector.CpuCollector
	loadAvg *collector.LoadAvgCollector
	history *history.RingBuffer[collector.CpuSnapshot]
}

func (m *CpuModule) Name() string { return "cpu" }

func (m *CpuModule) Init(cfg *config.Config) error {
	m.cpu = collector.NewCpuCollector()
	m.loadAvg = collector.NewLoadAvgCollector()
	m.history = history.NewRingBuffer[collector.CpuSnapshot](cfg.HistoryDuration, cfg.CollectInterval)
	return nil
}

func (m *CpuModule) Close() error        { return nil }
func (m *CpuModule) Interval() time.Duration { return 0 } // use global default

func (m *CpuModule) Collect() error {
	snap, err := m.cpu.Collect()
	if err != nil {
		return err
	}
	m.history.Push(*snap)
	return nil
}

func (m *CpuModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/cpu", Handler: m.handleGet},
	}
}

type cpuResponse struct {
	*collector.CpuSnapshot
	LoadAvg *collector.LoadAvg                    `json:"loadAvg,omitempty"`
	History []history.Entry[collector.CpuSnapshot] `json:"history,omitempty"`
}

func (m *CpuModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entry, ok := m.history.Latest()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "no CPU data available yet")
		return
	}

	resp := cpuResponse{CpuSnapshot: &entry.Data}

	if la, err := m.loadAvg.Collect(); err == nil {
		resp.LoadAvg = la
	}

	if r.URL.Query().Get("history") == "true" {
		resp.History = getHistory(m.history, r.URL.Query().Get("duration"))
	}

	writeJSON(w, http.StatusOK, resp)
}
