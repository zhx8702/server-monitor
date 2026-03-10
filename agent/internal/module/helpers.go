package module

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/server-monitor/agent/internal/history"
)

// writeJSON encodes v as JSON and writes it to w with appropriate headers.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// getHistory returns history entries from a ring buffer, optionally filtered by duration.
func getHistory[T any](rb *history.RingBuffer[T], durationStr string) []history.Entry[T] {
	if durationStr != "" {
		if duration, err := strconv.Atoi(durationStr); err == nil && duration > 0 {
			since := time.Now().Add(-time.Duration(duration) * time.Second)
			return rb.GetSince(since)
		}
	}
	return rb.GetAll()
}
