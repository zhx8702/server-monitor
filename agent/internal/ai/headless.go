package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// HeadlessConfig holds the configuration for a headless CLI execution.
type HeadlessConfig struct {
	CLI      string `json:"cli"`      // "claude" or "codex"
	APIKey   string `json:"apiKey"`
	Endpoint string `json:"endpoint"`
	Model    string `json:"model"`
}

// HeadlessRunner manages headless CLI process execution and session tracking.
type HeadlessRunner struct {
	mu       sync.Mutex
	sessions map[string]string // chatID → CLI session ID (for multi-turn)
}

// NewHeadlessRunner creates a new HeadlessRunner.
func NewHeadlessRunner() *HeadlessRunner {
	return &HeadlessRunner{
		sessions: make(map[string]string),
	}
}

// Execute spawns a headless CLI process for the given prompt and streams
// the output as SSE events.
func (h *HeadlessRunner) Execute(ctx context.Context, cfg HeadlessConfig, chatID string, prompt string, sse *SSEWriter) error {
	args, env := h.buildCommand(cfg, chatID, prompt)

	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Env = append(os.Environ(), env...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	// Capture stderr for error reporting
	var stderrBuf strings.Builder
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start CLI: %w", err)
	}

	// Parse output based on CLI type
	switch cfg.CLI {
	case "claude":
		h.parseClaudeStream(ctx, stdout, chatID, sse)
	case "codex":
		h.parseCodexStream(ctx, stdout, sse)
	default:
		io.Copy(io.Discard, stdout)
	}

	if err := cmd.Wait(); err != nil {
		// Context cancelled = user stopped generation, not an error
		if ctx.Err() != nil {
			return nil
		}
		stderr := strings.TrimSpace(stderrBuf.String())
		if stderr != "" {
			log.Printf("ai headless: stderr: %s", stderr)
			return fmt.Errorf("%s", stderr)
		}
		return fmt.Errorf("CLI exited: %w", err)
	}

	return nil
}

// ClearSession removes the stored session for a chat, used when clearing conversation.
func (h *HeadlessRunner) ClearSession(chatID string) {
	h.mu.Lock()
	delete(h.sessions, chatID)
	h.mu.Unlock()
}

// buildCommand constructs the command args and environment for the CLI.
func (h *HeadlessRunner) buildCommand(cfg HeadlessConfig, chatID string, prompt string) ([]string, []string) {
	var args []string
	var env []string

	bin := findCLIBinary(cfg.CLI)

	switch cfg.CLI {
	case "claude":
		args = []string{
			bin,
			"-p", prompt,
			"--output-format", "stream-json",
		}

		if cfg.Model != "" {
			args = append(args, "--model", cfg.Model)
		}

		// Resume session for multi-turn
		h.mu.Lock()
		if sid, ok := h.sessions[chatID]; ok {
			args = append(args, "--resume", sid)
		}
		h.mu.Unlock()

		env = append(env,
			"ANTHROPIC_API_KEY="+cfg.APIKey,
		)
		if cfg.Endpoint != "" {
			env = append(env, "ANTHROPIC_BASE_URL="+cfg.Endpoint)
		}

	case "codex":
		args = []string{
			bin, "exec",
			"--skip-git-repo-check",
			prompt,
		}

		if cfg.Model != "" {
			args = append(args, "--model", cfg.Model)
		}

		env = append(env,
			"OPENAI_API_KEY="+cfg.APIKey,
		)
		if cfg.Endpoint != "" {
			env = append(env, "OPENAI_BASE_URL="+cfg.Endpoint)
		}
	}

	log.Printf("ai headless: command=%v", args)
	return args, env
}

// findCLIBinary locates a CLI binary, searching PATH and common npm global locations.
func findCLIBinary(cmd string) string {
	// Try PATH first
	if p, err := exec.LookPath(cmd); err == nil {
		return p
	}

	// Search common npm global install locations
	home := os.Getenv("HOME")
	if home == "" {
		if h, err := os.UserHomeDir(); err == nil {
			home = h
		} else if os.Getuid() == 0 {
			home = "/root"
		}
	}

	candidates := []string{
		"/usr/local/bin/" + cmd,
		"/usr/bin/" + cmd,
	}
	if home != "" {
		// nvm versions
		nvmDir := filepath.Join(home, ".nvm", "versions", "node")
		if entries, err := os.ReadDir(nvmDir); err == nil {
			for i := len(entries) - 1; i >= 0; i-- { // newest first
				candidates = append([]string{
					filepath.Join(nvmDir, entries[i].Name(), "bin", cmd),
				}, candidates...)
			}
		}
		candidates = append(candidates, filepath.Join(home, ".local", "bin", cmd))
	}

	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Fallback to bare name (will likely fail with a clear error)
	return cmd
}

// --- Claude Code stream-json parser ---

// claudeStreamEvent represents a line from Claude Code's stream-json output.
type claudeStreamEvent struct {
	Type      string          `json:"type"`
	SessionID string          `json:"session_id,omitempty"`
	Event     json.RawMessage `json:"event,omitempty"`
	Result    string          `json:"result,omitempty"`
}

// claudeAPIEvent represents an inner Anthropic Messages API event.
type claudeAPIEvent struct {
	Type         string              `json:"type"`
	ContentBlock *claudeContentBlock `json:"content_block,omitempty"`
	Delta        *claudeDelta        `json:"delta,omitempty"`
	Index        int                 `json:"index,omitempty"`
}

type claudeContentBlock struct {
	Type  string `json:"type"` // "text", "tool_use", "tool_result"
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Text  string `json:"text,omitempty"`
}

type claudeDelta struct {
	Type        string `json:"type"` // "text_delta", "input_json_delta"
	Text        string `json:"text,omitempty"`
	PartialJSON string `json:"partial_json,omitempty"`
}

// toolAccumulator tracks a tool_use content block being assembled.
type toolAccumulator struct {
	id   string
	name string
	args strings.Builder
}

func (h *HeadlessRunner) parseClaudeStream(ctx context.Context, r io.Reader, chatID string, sse *SSEWriter) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)

	var currentTool *toolAccumulator

	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		var evt claudeStreamEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			log.Printf("ai headless: parse line: %v", err)
			continue
		}

		// Capture session ID for multi-turn
		if evt.SessionID != "" {
			h.mu.Lock()
			h.sessions[chatID] = evt.SessionID
			h.mu.Unlock()
		}

		switch evt.Type {
		case "stream_event":
			if evt.Event == nil {
				continue
			}
			var apiEvt claudeAPIEvent
			if err := json.Unmarshal(evt.Event, &apiEvt); err != nil {
				continue
			}
			currentTool = processClaudeAPIEvent(apiEvt, currentTool, sse)

		case "result":
			if evt.Result != "" {
				_ = sse.WriteEvent(SSEContentDelta, map[string]string{"content": evt.Result})
			}
		}
	}

	// Send done if we haven't already (process ended)
	_ = sse.WriteEvent(SSEDone, map[string]string{"content": ""})
}

// processClaudeAPIEvent handles a single Messages API event and returns the updated tool accumulator.
func processClaudeAPIEvent(evt claudeAPIEvent, tool *toolAccumulator, sse *SSEWriter) *toolAccumulator {
	switch evt.Type {
	case "content_block_start":
		if evt.ContentBlock == nil {
			return tool
		}
		switch evt.ContentBlock.Type {
		case "tool_use":
			return &toolAccumulator{
				id:   evt.ContentBlock.ID,
				name: evt.ContentBlock.Name,
			}
		case "text":
			if evt.ContentBlock.Text != "" {
				_ = sse.WriteEvent(SSEContentDelta, map[string]string{"content": evt.ContentBlock.Text})
			}
		}

	case "content_block_delta":
		if evt.Delta == nil {
			return tool
		}
		switch evt.Delta.Type {
		case "text_delta":
			if evt.Delta.Text != "" {
				_ = sse.WriteEvent(SSEContentDelta, map[string]string{"content": evt.Delta.Text})
			}
		case "input_json_delta":
			if tool != nil {
				tool.args.WriteString(evt.Delta.PartialJSON)
			}
		}

	case "content_block_stop":
		if tool != nil {
			_ = sse.WriteEvent(SSEToolCall, SSEToolCallData{
				ID:        tool.id,
				Name:      tool.name,
				Arguments: tool.args.String(),
			})
			return nil
		}

	case "message_stop":
		_ = sse.WriteEvent(SSEDone, map[string]string{"content": ""})
	}

	return tool
}

// --- Codex CLI parser ---

// codexEvent represents a line from Codex CLI --json output.
type codexEvent struct {
	Type    string `json:"type,omitempty"`
	Content string `json:"content,omitempty"`
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

func (h *HeadlessRunner) parseCodexStream(ctx context.Context, r io.Reader, sse *SSEWriter) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		var evt codexEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			// Not JSON — treat as raw text output
			_ = sse.WriteEvent(SSEContentDelta, map[string]string{"content": line + "\n"})
			continue
		}

		// Extract text content from various fields
		text := evt.Content
		if text == "" {
			text = evt.Text
		}
		if text == "" {
			text = evt.Message
		}
		if text != "" {
			_ = sse.WriteEvent(SSEContentDelta, map[string]string{"content": text})
		}
	}

	_ = sse.WriteEvent(SSEDone, map[string]string{"content": ""})
}
