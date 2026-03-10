package alert

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/version"
)

// Notifier sends alert notifications to configured channels.
type Notifier struct {
	client   *http.Client
	hostname string
}

// NewNotifier creates a notifier.
func NewNotifier(hostname string) *Notifier {
	return &Notifier{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		hostname: hostname,
	}
}

// webhookPayload is the JSON body sent to webhook URLs.
type webhookPayload struct {
	Status    string         `json:"status"` // "firing" or "resolved"
	Alert     webhookAlert   `json:"alert"`
	Timestamp string         `json:"timestamp"`
	Agent     webhookAgent   `json:"agent"`
}

type webhookAlert struct {
	Name      string  `json:"name"`
	Metric    string  `json:"metric"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
	Severity  string  `json:"severity"`
	Duration  string  `json:"duration"`
}

type webhookAgent struct {
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
}

// Send sends an alert event to all enabled channels.
func (n *Notifier) Send(event AlertEvent, channels []NotifyChannel, duration time.Duration) {
	payload := webhookPayload{
		Status: event.Status,
		Alert: webhookAlert{
			Name:      event.RuleName,
			Metric:    event.Metric,
			Value:     event.Value,
			Threshold: event.Threshold,
			Severity:  event.Severity,
			Duration:  duration.String(),
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Agent: webhookAgent{
			Hostname: n.hostname,
			Version:  version.Version,
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Alert notify: marshal error: %v", err)
		return
	}

	for _, ch := range channels {
		if !ch.Enabled || ch.Type != "webhook" {
			continue
		}
		go n.sendWebhook(ch, data)
	}
}

// SendTest sends a test notification to a specific channel.
func (n *Notifier) SendTest(ch NotifyChannel) error {
	payload := webhookPayload{
		Status: "test",
		Alert: webhookAlert{
			Name:     "测试通知",
			Metric:   "test",
			Severity: "info",
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Agent: webhookAgent{
			Hostname: n.hostname,
			Version:  version.Version,
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	return n.doPost(ch.URL, data)
}

func (n *Notifier) sendWebhook(ch NotifyChannel, data []byte) {
	if err := n.doPost(ch.URL, data); err != nil {
		log.Printf("Alert notify %q failed: %v", ch.Name, err)
	}
}

func (n *Notifier) doPost(url string, data []byte) error {
	resp, err := n.client.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("POST %s: HTTP %d", url, resp.StatusCode)
	}
	return nil
}
