package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

const maxIterations = 10

// ChatHandler orchestrates the agentic loop: LLM call → tool execution → repeat.
type ChatHandler struct {
	registry     *ToolRegistry
	provider     *Provider
	stateFetcher StateFetcher
}

// NewChatHandler creates a new ChatHandler.
func NewChatHandler(registry *ToolRegistry, provider *Provider, fetcher StateFetcher) *ChatHandler {
	return &ChatHandler{
		registry:     registry,
		provider:     provider,
		stateFetcher: fetcher,
	}
}

// HandleChat processes a chat request with the agentic loop.
// It writes SSE events to the ResponseWriter in real-time.
func (h *ChatHandler) HandleChat(w http.ResponseWriter, r *http.Request) {
	// Extend write deadline for long-running SSE
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(5 * time.Minute))

	// Parse request
	var req ChatAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	if req.Provider.APIKey == "" {
		http.Error(w, `{"error":"apiKey is required"}`, http.StatusBadRequest)
		return
	}
	if req.Provider.Model == "" {
		http.Error(w, `{"error":"model is required"}`, http.StatusBadRequest)
		return
	}
	if len(req.Messages) == 0 {
		http.Error(w, `{"error":"messages is required"}`, http.StatusBadRequest)
		return
	}

	// Create SSE writer
	sse, err := NewSSEWriter(w)
	if err != nil {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	ctx := r.Context()

	// Build system prompt with current server state
	state := h.stateFetcher()
	systemPrompt := BuildSystemPrompt(state)

	// Prepend system message
	messages := make([]ChatMessage, 0, len(req.Messages)+1)
	messages = append(messages, ChatMessage{
		Role:    "system",
		Content: systemPrompt,
	})
	messages = append(messages, req.Messages...)

	tools := h.registry.Definitions()

	// Agentic loop
	for i := 0; i < maxIterations; i++ {
		if ctx.Err() != nil {
			return
		}

		// Extend deadline for each iteration
		_ = rc.SetWriteDeadline(time.Now().Add(5 * time.Minute))

		chatReq := ChatRequest{
			Model:    req.Provider.Model,
			Messages: messages,
			Tools:    tools,
		}

		resp, err := h.provider.Chat(ctx, req.Provider, chatReq)
		if err != nil {
			_ = sse.WriteEvent(SSEError, map[string]string{"message": err.Error()})
			return
		}

		if len(resp.Choices) == 0 {
			_ = sse.WriteEvent(SSEError, map[string]string{"message": "LLM returned empty response"})
			return
		}

		choice := resp.Choices[0]
		assistantMsg := choice.Message

		// If the LLM wants to call tools, execute them
		if len(assistantMsg.ToolCalls) > 0 {
			// Append assistant message with tool calls to history
			messages = append(messages, assistantMsg)

			for _, tc := range assistantMsg.ToolCalls {
				// Notify frontend about the tool call
				_ = sse.WriteEvent(SSEToolCall, SSEToolCallData{
					ID:        tc.ID,
					Name:      tc.Function.Name,
					Arguments: tc.Function.Arguments,
				})

				// Execute the tool
				result, execErr := h.registry.Execute(tc.Function.Name, tc.Function.Arguments)

				resultData := SSEToolResultData{
					ID:   tc.ID,
					Name: tc.Function.Name,
				}
				if execErr != nil {
					resultData.Error = execErr.Error()
					resultData.Result = fmt.Sprintf("Error: %s", execErr.Error())
					log.Printf("AI tool %q error: %v", tc.Function.Name, execErr)
				} else {
					resultData.Result = result
				}

				_ = sse.WriteEvent(SSEToolResult, resultData)

				// Append tool result to message history
				toolContent := result
				if execErr != nil {
					toolContent = fmt.Sprintf("Error: %s", execErr.Error())
				}
				messages = append(messages, ChatMessage{
					Role:       "tool",
					Content:    toolContent,
					ToolCallID: tc.ID,
					Name:       tc.Function.Name,
				})
			}

			// Continue loop to send results back to LLM
			continue
		}

		// No tool calls — stream the final text response
		h.streamFinalResponse(ctx, sse, req.Provider, chatReq, assistantMsg.Content)
		return
	}

	// Exceeded max iterations
	_ = sse.WriteEvent(SSEError, map[string]string{
		"message": "reached maximum tool call iterations",
	})
}

// streamFinalResponse streams the final assistant response to the frontend.
// If we already have the full content from the non-streaming call, send it directly.
func (h *ChatHandler) streamFinalResponse(ctx context.Context, sse *SSEWriter, cfg ProviderConfig, req ChatRequest, content string) {
	if content != "" {
		// We already have the content from the non-streaming response
		_ = sse.WriteEvent(SSEContentDelta, map[string]string{"content": content})
		_ = sse.WriteEvent(SSEDone, map[string]string{"content": content})
		return
	}

	// Fall back to streaming call
	var fullContent string
	err := h.provider.ChatStream(ctx, cfg, req, func(delta string, done bool) error {
		if done {
			return sse.WriteEvent(SSEDone, map[string]string{"content": fullContent})
		}
		fullContent += delta
		return sse.WriteEvent(SSEContentDelta, map[string]string{"content": delta})
	})
	if err != nil {
		_ = sse.WriteEvent(SSEError, map[string]string{"message": err.Error()})
	}
}

// HandleTools returns all available tool definitions as JSON.
func (h *ChatHandler) HandleTools(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"tools": h.registry.Definitions(),
	})
}
