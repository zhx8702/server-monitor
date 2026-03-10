package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Claude-specific request/response types for the Anthropic Messages API.

type claudeRequest struct {
	Model     string               `json:"model"`
	MaxTokens int                  `json:"max_tokens"`
	System    string               `json:"system,omitempty"`
	Messages  []claudeMessage      `json:"messages"`
	Tools     []claudeTool         `json:"tools,omitempty"`
	Stream    bool                 `json:"stream,omitempty"`
}

type claudeMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string or []claudeContentBlock
}

type claudeContentBlock struct {
	Type      string          `json:"type"`                         // "text", "tool_use", "tool_result"
	Text      string          `json:"text,omitempty"`               // text block
	ID        string          `json:"id,omitempty"`                 // tool_use block
	Name      string          `json:"name,omitempty"`               // tool_use block
	Input     json.RawMessage `json:"input,omitempty"`              // tool_use block
	ToolUseID string          `json:"tool_use_id,omitempty"`        // tool_result block
	Content   string          `json:"content,omitempty"`            // tool_result block
}

type claudeTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type claudeResponse struct {
	ID         string               `json:"id"`
	Type       string               `json:"type"`
	Role       string               `json:"role"`
	Content    []claudeContentBlock `json:"content"`
	StopReason string               `json:"stop_reason"`
}

// chatClaude sends a non-streaming request to the Anthropic Messages API.
func (p *Provider) chatClaude(ctx context.Context, cfg ProviderConfig, req ChatRequest) (*ChatResponse, error) {
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint("claude")
	}
	url := strings.TrimRight(endpoint, "/") + "/messages"

	system, claudeMsgs := convertMessagesForClaude(req.Messages)
	claudeTools := convertToolsForClaude(req.Tools)

	claudeReq := claudeRequest{
		Model:     req.Model,
		MaxTokens: 8192,
		System:    system,
		Messages:  claudeMsgs,
		Tools:     claudeTools,
	}

	body, err := json.Marshal(claudeReq)
	if err != nil {
		return nil, fmt.Errorf("marshal claude request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", cfg.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("Claude API call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read Claude response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Claude API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var claudeResp claudeResponse
	if err := json.Unmarshal(respBody, &claudeResp); err != nil {
		preview := string(respBody)
		if len(preview) > 300 {
			preview = preview[:300] + "..."
		}
		return nil, fmt.Errorf("decode Claude response (got: %s): %w", preview, err)
	}

	return convertClaudeResponse(&claudeResp), nil
}

// chatStreamClaude sends a streaming request to the Anthropic Messages API.
func (p *Provider) chatStreamClaude(ctx context.Context, cfg ProviderConfig, req ChatRequest, callback StreamCallback) error {
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint("claude")
	}
	url := strings.TrimRight(endpoint, "/") + "/messages"

	system, claudeMsgs := convertMessagesForClaude(req.Messages)
	claudeTools := convertToolsForClaude(req.Tools)

	claudeReq := claudeRequest{
		Model:     req.Model,
		MaxTokens: 8192,
		System:    system,
		Messages:  claudeMsgs,
		Tools:     claudeTools,
		Stream:    true,
	}

	body, err := json.Marshal(claudeReq)
	if err != nil {
		return fmt.Errorf("marshal claude request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", cfg.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	streamClient := &http.Client{}
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("Claude streaming call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Claude API returned %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse Claude's SSE stream
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch event.Type {
		case "content_block_delta":
			if event.Delta.Type == "text_delta" && event.Delta.Text != "" {
				if err := callback(event.Delta.Text, false); err != nil {
					return err
				}
			}
		case "message_stop":
			return callback("", true)
		}
	}

	return scanner.Err()
}

// convertMessagesForClaude converts OpenAI-format messages to Claude format.
// System messages are extracted and returned separately.
func convertMessagesForClaude(messages []ChatMessage) (string, []claudeMessage) {
	var system string
	var result []claudeMessage

	i := 0
	for i < len(messages) {
		msg := messages[i]

		switch msg.Role {
		case "system":
			system = msg.Content
			i++

		case "user":
			result = append(result, claudeMessage{
				Role:    "user",
				Content: msg.Content,
			})
			i++

		case "assistant":
			if len(msg.ToolCalls) > 0 {
				var blocks []claudeContentBlock
				if msg.Content != "" {
					blocks = append(blocks, claudeContentBlock{
						Type: "text",
						Text: msg.Content,
					})
				}
				for _, tc := range msg.ToolCalls {
					blocks = append(blocks, claudeContentBlock{
						Type:  "tool_use",
						ID:    tc.ID,
						Name:  tc.Function.Name,
						Input: json.RawMessage(tc.Function.Arguments),
					})
				}
				result = append(result, claudeMessage{
					Role:    "assistant",
					Content: blocks,
				})
			} else {
				result = append(result, claudeMessage{
					Role:    "assistant",
					Content: msg.Content,
				})
			}
			i++

		case "tool":
			// Group consecutive tool messages into one user message with tool_result blocks
			var blocks []claudeContentBlock
			for i < len(messages) && messages[i].Role == "tool" {
				blocks = append(blocks, claudeContentBlock{
					Type:      "tool_result",
					ToolUseID: messages[i].ToolCallID,
					Content:   messages[i].Content,
				})
				i++
			}
			result = append(result, claudeMessage{
				Role:    "user",
				Content: blocks,
			})

		default:
			i++
		}
	}

	return system, result
}

// convertToolsForClaude converts OpenAI-format tool definitions to Claude format.
func convertToolsForClaude(tools []ToolDef) []claudeTool {
	if len(tools) == 0 {
		return nil
	}
	result := make([]claudeTool, len(tools))
	for i, t := range tools {
		result[i] = claudeTool{
			Name:        t.Function.Name,
			Description: t.Function.Description,
			InputSchema: t.Function.Parameters,
		}
	}
	return result
}

// convertClaudeResponse converts a Claude API response to our internal OpenAI-like format.
func convertClaudeResponse(resp *claudeResponse) *ChatResponse {
	choice := ChatChoice{}
	choice.Message.Role = "assistant"

	var textParts []string
	var toolCalls []ToolCall

	for _, block := range resp.Content {
		switch block.Type {
		case "text":
			textParts = append(textParts, block.Text)
		case "tool_use":
			toolCalls = append(toolCalls, ToolCall{
				ID:   block.ID,
				Type: "function",
				Function: ToolCallFunc{
					Name:      block.Name,
					Arguments: string(block.Input),
				},
			})
		}
	}

	choice.Message.Content = strings.Join(textParts, "")
	choice.Message.ToolCalls = toolCalls

	switch resp.StopReason {
	case "tool_use":
		choice.FinishReason = "tool_calls"
	default:
		choice.FinishReason = "stop"
	}

	return &ChatResponse{Choices: []ChatChoice{choice}}
}
