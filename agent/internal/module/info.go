package module

import (
	"net/http"
	"time"

	"github.com/server-monitor/agent/internal/version"
)

// ModuleInfo describes a loaded module in the /api/info response.
type ModuleInfo struct {
	Name string `json:"name"`
	Type string `json:"type"` // "periodic" or "on-demand"
}

// InfoResponse is the JSON response for GET /api/info.
type InfoResponse struct {
	Version   string       `json:"version"`
	Commit    string       `json:"commit"`
	BuildTime string       `json:"buildTime"`
	Uptime    int64        `json:"uptime"`
	Modules   []ModuleInfo `json:"modules"`
}

// InfoHandler returns a handler for GET /api/info.
func InfoHandler(modules []Module, startTime time.Time) http.HandlerFunc {
	// Pre-compute module list since it doesn't change at runtime
	modInfos := make([]ModuleInfo, len(modules))
	for i, m := range modules {
		modType := "on-demand"
		if _, ok := m.(PeriodicModule); ok {
			modType = "periodic"
		}
		modInfos[i] = ModuleInfo{Name: m.Name(), Type: modType}
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeJSON(w, http.StatusOK, InfoResponse{
			Version:   version.Version,
			Commit:    version.Commit,
			BuildTime: version.BuildTime,
			Uptime:    int64(time.Since(startTime).Seconds()),
			Modules:   modInfos,
		})
	}
}

// HealthHandler returns a handler for GET /api/health.
func HealthHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"version":   version.Version,
		})
	}
}
