package alert

import (
	"log"
	"sync"
	"time"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/history"
)

// Engine evaluates alert rules against current metrics.
type Engine struct {
	mu       sync.RWMutex
	rules    []AlertRule
	channels []NotifyChannel
	store    *ConfigStore
	history  *history.RingBuffer[AlertEvent]
	firing   map[string]*firingState // ruleID → state
	notifier *Notifier
	cooldown time.Duration

	memCollector  *collector.MemoryCollector
	loadCollector *collector.LoadAvgCollector
	diskCollector *collector.DiskCollector
}

// firingState tracks an active alert condition.
type firingState struct {
	firstSeen time.Time
	notified  bool
	lastValue float64
	firedAt   time.Time // time the alert was actually fired (after duration)
}

// NewEngine creates a new alert evaluation engine.
func NewEngine(store *ConfigStore, hostname string) *Engine {
	return &Engine{
		store:         store,
		firing:        make(map[string]*firingState),
		history:       history.NewRingBuffer[AlertEvent](3600, 2), // ~30 min of events at 2s interval
		notifier:      NewNotifier(hostname),
		cooldown:      5 * time.Minute,
		memCollector:  collector.NewMemoryCollector(),
		loadCollector: collector.NewLoadAvgCollector(),
		diskCollector: collector.NewDiskCollector(),
	}
}

// LoadConfig loads rules and channels from the config file.
func (e *Engine) LoadConfig() error {
	rules, channels, err := e.store.Load()
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.rules = rules
	e.channels = channels
	e.mu.Unlock()
	return nil
}

// Evaluate reads current metrics and checks all enabled rules.
// Called once per scheduler collect cycle.
func (e *Engine) Evaluate() {
	e.mu.RLock()
	rules := make([]AlertRule, len(e.rules))
	copy(rules, e.rules)
	channels := make([]NotifyChannel, len(e.channels))
	copy(channels, e.channels)
	e.mu.RUnlock()

	if len(rules) == 0 {
		return
	}

	metrics := e.readMetrics()
	now := time.Now()

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}

		value, ok := e.metricValue(metrics, rule)
		if !ok {
			continue
		}

		triggered := CheckCondition(value, rule.Operator, rule.Threshold)

		if triggered {
			e.handleFiring(rule, value, now, channels)
		} else {
			e.handleResolved(rule, value, now, channels)
		}
	}
}

// metricSnapshot holds current readings from collectors.
type metricSnapshot struct {
	memory *collector.MemorySnapshot
	load   *collector.LoadAvg
	disk   *collector.DiskSnapshot
}

func (e *Engine) readMetrics() metricSnapshot {
	var snap metricSnapshot

	if mem, err := e.memCollector.Collect(); err == nil {
		snap.memory = mem
	}
	if load, err := e.loadCollector.Collect(); err == nil {
		snap.load = load
	}
	if disk, err := e.diskCollector.Collect(); err == nil {
		snap.disk = disk
	}

	return snap
}

func (e *Engine) metricValue(snap metricSnapshot, rule AlertRule) (float64, bool) {
	switch rule.Metric {
	case "memory_usage":
		if snap.memory != nil {
			return snap.memory.UsagePercent, true
		}
	case "disk_usage":
		if snap.disk != nil {
			for _, fs := range snap.disk.Filesystems {
				if fs.MountPoint == rule.MountPoint {
					return fs.UsedPct, true
				}
			}
		}
	case "load_1":
		if snap.load != nil {
			return snap.load.Load1, true
		}
	case "load_5":
		if snap.load != nil {
			return snap.load.Load5, true
		}
	case "load_15":
		if snap.load != nil {
			return snap.load.Load15, true
		}
	}
	return 0, false
}

func (e *Engine) handleFiring(rule AlertRule, value float64, now time.Time, channels []NotifyChannel) {
	state, exists := e.firing[rule.ID]
	if !exists {
		// First time condition is true
		e.firing[rule.ID] = &firingState{
			firstSeen: now,
			lastValue: value,
		}
		return
	}

	state.lastValue = value

	// Check if duration threshold has been reached
	elapsed := now.Sub(state.firstSeen)
	if elapsed < time.Duration(rule.Duration)*time.Second {
		return // not yet long enough
	}

	if state.notified {
		return // already notified, wait for resolve
	}

	// Fire the alert
	state.notified = true
	state.firedAt = now

	event := AlertEvent{
		RuleID:    rule.ID,
		RuleName:  rule.Name,
		Metric:    rule.Metric,
		Value:     value,
		Threshold: rule.Threshold,
		Severity:  rule.Severity,
		Status:    "firing",
		FiredAt:   now,
	}
	e.history.Push(event)
	e.notifier.Send(event, channels, elapsed)
	log.Printf("Alert FIRING: %s (%s %s %.1f, current=%.1f)",
		rule.Name, rule.Metric, rule.Operator, rule.Threshold, value)
}

func (e *Engine) handleResolved(rule AlertRule, value float64, now time.Time, channels []NotifyChannel) {
	state, exists := e.firing[rule.ID]
	if !exists {
		return // wasn't firing
	}

	// If it was notified, send a resolved notification
	if state.notified {
		resolved := now
		event := AlertEvent{
			RuleID:     rule.ID,
			RuleName:   rule.Name,
			Metric:     rule.Metric,
			Value:      value,
			Threshold:  rule.Threshold,
			Severity:   rule.Severity,
			Status:     "resolved",
			FiredAt:    state.firedAt,
			ResolvedAt: &resolved,
		}
		e.history.Push(event)
		e.notifier.Send(event, channels, now.Sub(state.firedAt))
		log.Printf("Alert RESOLVED: %s (%s=%.1f)", rule.Name, rule.Metric, value)
	}

	delete(e.firing, rule.ID)
}

// --- Accessors for API ---

// Rules returns a copy of current rules.
func (e *Engine) Rules() []AlertRule {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]AlertRule, len(e.rules))
	copy(out, e.rules)
	return out
}

// Channels returns a copy of current channels.
func (e *Engine) Channels() []NotifyChannel {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]NotifyChannel, len(e.channels))
	copy(out, e.channels)
	return out
}

// UpsertRule adds or updates a rule by ID, then persists.
func (e *Engine) UpsertRule(rule AlertRule) error {
	e.mu.Lock()
	found := false
	for i, r := range e.rules {
		if r.ID == rule.ID {
			e.rules[i] = rule
			found = true
			break
		}
	}
	if !found {
		e.rules = append(e.rules, rule)
	}
	rules := make([]AlertRule, len(e.rules))
	copy(rules, e.rules)
	channels := make([]NotifyChannel, len(e.channels))
	copy(channels, e.channels)
	e.mu.Unlock()

	return e.store.Save(rules, channels)
}

// DeleteRule removes a rule by ID, then persists.
func (e *Engine) DeleteRule(id string) error {
	e.mu.Lock()
	for i, r := range e.rules {
		if r.ID == id {
			e.rules = append(e.rules[:i], e.rules[i+1:]...)
			break
		}
	}
	// Clean up firing state
	delete(e.firing, id)

	rules := make([]AlertRule, len(e.rules))
	copy(rules, e.rules)
	channels := make([]NotifyChannel, len(e.channels))
	copy(channels, e.channels)
	e.mu.Unlock()

	return e.store.Save(rules, channels)
}

// UpsertChannel adds or updates a channel by ID, then persists.
func (e *Engine) UpsertChannel(ch NotifyChannel) error {
	e.mu.Lock()
	found := false
	for i, c := range e.channels {
		if c.ID == ch.ID {
			e.channels[i] = ch
			found = true
			break
		}
	}
	if !found {
		e.channels = append(e.channels, ch)
	}
	rules := make([]AlertRule, len(e.rules))
	copy(rules, e.rules)
	channels := make([]NotifyChannel, len(e.channels))
	copy(channels, e.channels)
	e.mu.Unlock()

	return e.store.Save(rules, channels)
}

// DeleteChannel removes a channel by ID, then persists.
func (e *Engine) DeleteChannel(id string) error {
	e.mu.Lock()
	for i, c := range e.channels {
		if c.ID == id {
			e.channels = append(e.channels[:i], e.channels[i+1:]...)
			break
		}
	}
	rules := make([]AlertRule, len(e.rules))
	copy(rules, e.rules)
	channels := make([]NotifyChannel, len(e.channels))
	copy(channels, e.channels)
	e.mu.Unlock()

	return e.store.Save(rules, channels)
}

// ActiveCount returns the number of currently firing alerts.
func (e *Engine) ActiveCount() int {
	count := 0
	for _, s := range e.firing {
		if s.notified {
			count++
		}
	}
	return count
}

// History returns recent alert events.
func (e *Engine) History() []history.Entry[AlertEvent] {
	return e.history.GetAll()
}

// TestNotify sends a test notification to a specific channel by ID.
func (e *Engine) TestNotify(channelID string) error {
	e.mu.RLock()
	var ch *NotifyChannel
	for _, c := range e.channels {
		if c.ID == channelID {
			cc := c
			ch = &cc
			break
		}
	}
	e.mu.RUnlock()

	if ch == nil {
		return &NotFoundError{What: "channel", ID: channelID}
	}
	return e.notifier.SendTest(*ch)
}

// NotFoundError indicates a resource was not found.
type NotFoundError struct {
	What string
	ID   string
}

func (e *NotFoundError) Error() string {
	return e.What + " " + e.ID + " not found"
}
