package module

import (
	"encoding/json"
	"net/http"

	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
)

func init() {
	Register("docker", func() Module { return &DockerModule{} })
}

// DockerModule wraps DockerCollector as a Module with action support.
type DockerModule struct {
	collector *collector.DockerCollector
}

func (m *DockerModule) Name() string { return "docker" }

func (m *DockerModule) Init(cfg *config.Config) error {
	socket := cfg.ModuleOption("docker", "socket", "/var/run/docker.sock")
	m.collector = collector.NewDockerCollector(socket)
	return nil
}

func (m *DockerModule) Close() error { return nil }

func (m *DockerModule) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/docker", Handler: m.handleGet},
		{Method: http.MethodPost, Path: "/api/docker/action", Handler: m.handleAction},
	}
}

func (m *DockerModule) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	snap := m.collector.Collect()
	writeJSON(w, http.StatusOK, snap)
}

type dockerActionRequest struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}

func (m *DockerModule) handleAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req dockerActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.ID == "" || req.Action == "" {
		writeError(w, http.StatusBadRequest, "id and action are required")
		return
	}

	if err := m.collector.ContainerAction(req.ID, req.Action); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
