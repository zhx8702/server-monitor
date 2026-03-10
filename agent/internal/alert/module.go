package alert

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/history"
	"github.com/server-monitor/agent/internal/module"
)

func init() {
	module.Register("alert", func() module.Module { return &AlertModule{} })
}

// AlertModule wraps the alert engine as a PeriodicModule.
type AlertModule struct {
	engine *Engine
}

func (m *AlertModule) Name() string { return "alert" }

func (m *AlertModule) Init(cfg *config.Config) error {
	store := NewConfigStore(cfg.AlertsConfig)

	hostname, _ := os.Hostname()
	m.engine = NewEngine(store, hostname)

	if err := m.engine.LoadConfig(); err != nil {
		log.Printf("Alert: config load warning: %v (starting with empty rules)", err)
	}

	rules := m.engine.Rules()
	channels := m.engine.Channels()
	log.Printf("Alert module loaded: %d rules, %d channels", len(rules), len(channels))

	return nil
}

func (m *AlertModule) Collect() error {
	m.engine.Evaluate()
	return nil
}

func (m *AlertModule) Interval() time.Duration { return 0 }
func (m *AlertModule) Close() error            { return nil }

func (m *AlertModule) Routes() []module.Route {
	return []module.Route{
		{Path: "/api/alerts", Handler: m.handleOverview},
		{Path: "/api/alerts/rules", Handler: m.handleRules},
		{Path: "/api/alerts/rules/delete", Handler: m.handleDeleteRule},
		{Path: "/api/alerts/channels", Handler: m.handleChannels},
		{Path: "/api/alerts/channels/delete", Handler: m.handleDeleteChannel},
		{Path: "/api/alerts/history", Handler: m.handleHistory},
		{Path: "/api/alerts/test", Handler: m.handleTest},
	}
}

func (m *AlertModule) handleRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		m.handleGetRules(w, r)
	case http.MethodPost:
		m.handleUpsertRule(w, r)
	default:
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (m *AlertModule) handleChannels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		m.handleGetChannels(w, r)
	case http.MethodPost:
		m.handleUpsertChannel(w, r)
	default:
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- Handlers ---

type overviewResponse struct {
	ActiveCount  int          `json:"activeCount"`
	RuleCount    int          `json:"ruleCount"`
	ChannelCount int          `json:"channelCount"`
	RecentEvents []AlertEvent `json:"recentEvents"`
}

func (m *AlertModule) handleOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entries := m.engine.History()
	events := make([]AlertEvent, 0, len(entries))
	for _, e := range entries {
		events = append(events, e.Data)
	}
	// Reverse to show newest first, limit to 20
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}
	if len(events) > 20 {
		events = events[:20]
	}

	writeAlertJSON(w, http.StatusOK, overviewResponse{
		ActiveCount:  m.engine.ActiveCount(),
		RuleCount:    len(m.engine.Rules()),
		ChannelCount: len(m.engine.Channels()),
		RecentEvents: events,
	})
}

func (m *AlertModule) handleGetRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeAlertJSON(w, http.StatusOK, m.engine.Rules())
}

func (m *AlertModule) handleUpsertRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var rule AlertRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		writeAlertError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if rule.ID == "" {
		writeAlertError(w, http.StatusBadRequest, "id is required")
		return
	}
	if !ValidMetrics[rule.Metric] {
		writeAlertError(w, http.StatusBadRequest, "invalid metric: "+rule.Metric+". valid: "+validMetricsList())
		return
	}
	if rule.Metric == "disk_usage" && rule.MountPoint == "" {
		writeAlertError(w, http.StatusBadRequest, "mountPoint is required for disk_usage metric")
		return
	}

	if err := m.engine.UpsertRule(rule); err != nil {
		writeAlertError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAlertJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type deleteRequest struct {
	ID string `json:"id"`
}

func (m *AlertModule) handleDeleteRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req deleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAlertError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if err := m.engine.DeleteRule(req.ID); err != nil {
		writeAlertError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAlertJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (m *AlertModule) handleGetChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeAlertJSON(w, http.StatusOK, m.engine.Channels())
}

func (m *AlertModule) handleUpsertChannel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var ch NotifyChannel
	if err := json.NewDecoder(r.Body).Decode(&ch); err != nil {
		writeAlertError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if ch.ID == "" || ch.URL == "" {
		writeAlertError(w, http.StatusBadRequest, "id and url are required")
		return
	}
	if ch.Type == "" {
		ch.Type = "webhook"
	}

	if err := m.engine.UpsertChannel(ch); err != nil {
		writeAlertError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAlertJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (m *AlertModule) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req deleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAlertError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if err := m.engine.DeleteChannel(req.ID); err != nil {
		writeAlertError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAlertJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (m *AlertModule) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	entries := m.engine.History()
	events := make([]history.Entry[AlertEvent], len(entries))
	copy(events, entries)

	// Reverse: newest first
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}

	writeAlertJSON(w, http.StatusOK, events)
}

type testRequest struct {
	ChannelID string `json:"channelId"`
}

func (m *AlertModule) handleTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAlertError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req testRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAlertError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if err := m.engine.TestNotify(req.ChannelID); err != nil {
		if _, ok := err.(*NotFoundError); ok {
			writeAlertError(w, http.StatusNotFound, err.Error())
		} else {
			writeAlertError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeAlertJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- helpers ---

func writeAlertJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeAlertError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func validMetricsList() string {
	keys := make([]string, 0, len(ValidMetrics))
	for k := range ValidMetrics {
		keys = append(keys, k)
	}
	return strings.Join(keys, ", ")
}
