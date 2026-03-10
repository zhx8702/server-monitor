package ai

import (
	"encoding/json"
	"net/http"
	"time"
)

// ChatHandler handles AI chat requests using headless CLI tools.
type ChatHandler struct {
	runner *HeadlessRunner
}

// NewChatHandler creates a new ChatHandler.
func NewChatHandler(runner *HeadlessRunner) *ChatHandler {
	return &ChatHandler{runner: runner}
}

// HandleChat spawns a headless CLI process and streams output as SSE.
func (h *ChatHandler) HandleChat(w http.ResponseWriter, r *http.Request) {
	// Extend write deadline for long-running SSE
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Minute))

	var req ChatAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	if req.CLI != "claude" && req.CLI != "codex" {
		http.Error(w, `{"error":"cli must be claude or codex"}`, http.StatusBadRequest)
		return
	}
	if req.APIKey == "" {
		http.Error(w, `{"error":"apiKey is required"}`, http.StatusBadRequest)
		return
	}
	if req.Prompt == "" {
		http.Error(w, `{"error":"prompt is required"}`, http.StatusBadRequest)
		return
	}
	if req.ChatID == "" {
		http.Error(w, `{"error":"chatId is required"}`, http.StatusBadRequest)
		return
	}

	sse, err := NewSSEWriter(w)
	if err != nil {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	cfg := HeadlessConfig{
		CLI:      req.CLI,
		APIKey:   req.APIKey,
		Endpoint: req.Endpoint,
		Model:    req.Model,
	}

	if err := h.runner.Execute(r.Context(), cfg, req.ChatID, req.Prompt, sse); err != nil {
		_ = sse.WriteEvent(SSEError, map[string]string{"message": err.Error()})
	}
}

// HandleClearSession clears a chat session's stored CLI session.
func (h *ChatHandler) HandleClearSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChatID string `json:"chatId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ChatID == "" {
		http.Error(w, `{"error":"chatId is required"}`, http.StatusBadRequest)
		return
	}

	h.runner.ClearSession(req.ChatID)
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

// RegisterRoutes registers AI chat routes.
func (h *ChatHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/ai/chat", h.HandleChat)
	mux.HandleFunc("POST /api/ai/clear-session", h.HandleClearSession)
}
