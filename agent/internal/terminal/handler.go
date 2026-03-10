package terminal

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"time"

	"nhooyr.io/websocket"
)

// Handler handles WebSocket terminal connections.
type Handler struct {
	manager   *Manager
	authToken string
}

// NewHandler creates a new terminal WebSocket handler.
func NewHandler(manager *Manager, authToken string) *Handler {
	return &Handler{manager: manager, authToken: authToken}
}

// wsMessage is the JSON message format from the client.
type wsMessage struct {
	Type string `json:"type"` // "input", "resize", "ping"
	Data string `json:"data,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
}

// HandleWS handles a WebSocket terminal connection.
func (h *Handler) HandleWS(w http.ResponseWriter, r *http.Request) {
	// Auth: check token from query param
	token := r.URL.Query().Get("token")
	if token != h.authToken {
		http.Error(w, "unauthorized", http.StatusForbidden)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("terminal: websocket accept: %v", err)
		return
	}
	defer conn.CloseNow()

	// Determine command to run
	command := r.URL.Query().Get("cmd")
	if command == "" {
		command = "bash"
	}

	// Build the actual command and args
	actualCmd, actualArgs := resolveCommand(command)

	// Build environment variables for AI CLI tools
	var env []string
	if apiKey := r.URL.Query().Get("api_key"); apiKey != "" {
		switch command {
		case "codex":
			env = append(env, "OPENAI_API_KEY="+apiKey)
		case "claude":
			env = append(env, "ANTHROPIC_API_KEY="+apiKey)
		}
	}
	if endpoint := r.URL.Query().Get("endpoint"); endpoint != "" {
		switch command {
		case "codex":
			env = append(env, "OPENAI_BASE_URL="+endpoint)
		case "claude":
			env = append(env, "ANTHROPIC_BASE_URL="+endpoint)
		}
	}

	// Generate session ID
	sessionID := fmt.Sprintf("term-%d", time.Now().UnixNano())

	sess, err := h.manager.Create(sessionID, actualCmd, actualArgs, env)
	if err != nil {
		conn.Close(websocket.StatusInternalError, err.Error())
		return
	}
	defer h.manager.Remove(sessionID)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// PTY output -> WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := sess.Read(buf)
			if err != nil {
				cancel()
				return
			}
			if n > 0 {
				if err := conn.Write(ctx, websocket.MessageBinary, buf[:n]); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	// WebSocket input -> PTY
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}

		var msg wsMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			// Raw input fallback
			sess.Write(data)
			continue
		}

		switch msg.Type {
		case "input":
			sess.Write([]byte(msg.Data))
		case "resize":
			sess.Resize(msg.Rows, msg.Cols)
		case "ping":
			conn.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`))
		}
	}
}

// resolveCommand resolves a user-friendly command name to the actual binary and args.
// For codex/claude, wraps in tmux for session persistence.
func resolveCommand(command string) (string, []string) {
	switch command {
	case "codex":
		// Check if codex is installed
		if path, err := exec.LookPath("codex"); err == nil {
			// Wrap in tmux for session persistence if available
			if _, tmuxErr := exec.LookPath("tmux"); tmuxErr == nil {
				sessionName := fmt.Sprintf("sm-codex-%d", time.Now().Unix())
				return "tmux", []string{"new-session", "-s", sessionName, path}
			}
			return path, nil
		}
		// Fallback to bash with a helpful message
		return "bash", []string{"-c", "echo 'Codex CLI not installed. Install with: npm install -g @openai/codex' && exec bash"}
	case "claude":
		if path, err := exec.LookPath("claude"); err == nil {
			if _, tmuxErr := exec.LookPath("tmux"); tmuxErr == nil {
				sessionName := fmt.Sprintf("sm-claude-%d", time.Now().Unix())
				return "tmux", []string{"new-session", "-s", sessionName, path}
			}
			return path, nil
		}
		return "bash", []string{"-c", "echo 'Claude Code not installed. Install with: npm install -g @anthropic-ai/claude-code' && exec bash"}
	default:
		return command, nil
	}
}

// RegisterRoutes registers terminal WebSocket and setup routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/terminal/ws", h.HandleWS)
	mux.HandleFunc("GET /api/terminal/status", h.HandleStatus)
	mux.HandleFunc("POST /api/terminal/setup", h.HandleSetup)
}
