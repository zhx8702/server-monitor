package plugin

import (
	"encoding/json"
	"net/http"
	"strings"
)

// API exposes plugin management endpoints.
type API struct {
	mgr   *Manager
	store *Store
}

// NewAPI creates a plugin management API handler.
func NewAPI(mgr *Manager, store *Store) *API {
	return &API{mgr: mgr, store: store}
}

// RegisterRoutes registers all plugin management routes on the given mux.
func (a *API) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/plugins", a.handleList)
	mux.HandleFunc("/api/plugins/", a.handlePluginAction)
}

// pluginsResponse is the JSON response for GET /api/plugins.
type pluginsResponse struct {
	Installed []PluginStatus `json:"installed"`
	Available []RemotePlugin `json:"available,omitempty"`
}

// handleList returns installed and available plugins.
// GET /api/plugins
// GET /api/plugins?available=true  (also fetch store index)
func (a *API) handleList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeAPIError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	resp := pluginsResponse{
		Installed: a.mgr.InstalledPlugins(),
	}

	if r.URL.Query().Get("available") == "true" {
		resp.Available = a.store.Index()
	}

	writeAPIJSON(w, http.StatusOK, resp)
}

// handlePluginAction routes plugin-specific actions.
// POST /api/plugins/{name}/install
// POST /api/plugins/{name}/uninstall
func (a *API) handlePluginAction(w http.ResponseWriter, r *http.Request) {
	// Parse: /api/plugins/{name}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/api/plugins/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		writeAPIError(w, http.StatusNotFound, "expected /api/plugins/{name}/{action}")
		return
	}

	name := parts[0]
	action := parts[1]

	if r.Method != http.MethodPost {
		writeAPIError(w, http.StatusMethodNotAllowed, "use POST for plugin actions")
		return
	}

	switch action {
	case "install":
		a.handleInstall(w, r, name)
	case "uninstall":
		a.handleUninstall(w, name)
	default:
		writeAPIError(w, http.StatusNotFound, "unknown action: "+action)
	}
}

// installRequest is the optional JSON body for install.
type installRequest struct {
	Version string `json:"version"` // empty = latest
}

func (a *API) handleInstall(w http.ResponseWriter, r *http.Request, name string) {
	var req installRequest
	if r.Body != nil {
		defer r.Body.Close()
		json.NewDecoder(r.Body).Decode(&req) // ignore error, defaults are fine
	}

	if err := a.mgr.Install(a.store, name, req.Version); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeAPIJSON(w, http.StatusOK, map[string]string{
		"status":  "installed",
		"plugin":  name,
		"message": "Plugin installed. Restart agent to activate.",
	})
}

func (a *API) handleUninstall(w http.ResponseWriter, name string) {
	if err := a.mgr.Uninstall(name); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeAPIJSON(w, http.StatusOK, map[string]string{
		"status": "uninstalled",
		"plugin": name,
	})
}

func writeAPIJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
