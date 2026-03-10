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

// OpenAI Responses API types

type responsesRequest struct {
	Model        string            `json:"model"`
	Instructions string            `json:"instructions,omitempty"`
	Input        []responsesInput  `json:"input"`
	Tools        []responsesTool   `json:"tools,omitempty"`
	Stream       bool              `json:"stream"`
}

type responsesInput struct {
	// For user/assistant messages
	Role    string `json:"role,omitempty"`
	Content string `json:"content,omitempty"`
	// For function_call items
	Type      string `json:"type,omitempty"`
	ID        string `json:"id,omitempty"`
	CallID    string `json:"call_id,omitempty"`
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
	// For function_call_output items
	Output string `json:"output,omitempty"`
}

type responsesTool struct {
	Type        string          `json:"type"` // "function"
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

type responsesResponse struct {
	ID     string            `json:"id"`
	Status string            `json:"status"`
	Output []responsesOutput `json:"output"`
}

type responsesOutput struct {
	Type    string                   `json:"type"` // "message" or "function_call"
	Content []responsesOutputContent `json:"content,omitempty"`
	// For function_call
	ID        string `json:"id,omitempty"`
	CallID    string `json:"call_id,omitempty"`
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type responsesOutputContent struct {
	Type string `json:"type"` // "output_text"
	Text string `json:"text"`
}

// chatResponses sends a non-streaming request to the OpenAI Responses API.
func (p *Provider) chatResponses(ctx context.Context, cfg ProviderConfig, req ChatRequest) (*ChatResponse, error) {
	endpoint := cfg.Endpoint
	if endpoint == "" {
		return nil, fmt.Errorf("no endpoint configured for sub2api provider")
	}

	url := strings.TrimRight(endpoint, "/") + "/responses"

	// Convert messages and tools
	instructions, input := convertToResponsesInput(req.Messages)
	tools := convertToResponsesTools(req.Tools)

	rReq := responsesRequest{
		Model:        req.Model,
		Instructions: instructions,
		Input:        input,
		Tools:        tools,
		Stream:       false,
	}

	body, err := json.Marshal(rReq)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("Responses API call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Responses API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var rResp responsesResponse
	if err := json.Unmarshal(respBody, &rResp); err != nil {
		preview := string(respBody)
		if len(preview) > 300 {
			preview = preview[:300] + "..."
		}
		return nil, fmt.Errorf("decode Responses API response (got: %s): %w", preview, err)
	}

	return convertResponsesToChatResponse(rResp), nil
}

// chatStreamResponses sends a streaming request to the OpenAI Responses API.
func (p *Provider) chatStreamResponses(ctx context.Context, cfg ProviderConfig, req ChatRequest, callback StreamCallback) error {
	endpoint := cfg.Endpoint
	if endpoint == "" {
		return fmt.Errorf("no endpoint configured for sub2api provider")
	}

	url := strings.TrimRight(endpoint, "/") + "/responses"

	instructions, input := convertToResponsesInput(req.Messages)

	rReq := responsesRequest{
		Model:        req.Model,
		Instructions: instructions,
		Input:        input,
		Stream:       true,
	}

	body, err := json.Marshal(rReq)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	streamClient := &http.Client{}
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("streaming call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Responses API returned %d: %s", resp.StatusCode, string(respBody))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		var event struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch event.Type {
		case "response.output_text.delta":
			if event.Delta != "" {
				if err := callback(event.Delta, false); err != nil {
					return err
				}
			}
		case "response.completed":
			return callback("", true)
		}
	}

	return scanner.Err()
}

// convertToResponsesInput converts OpenAI-format messages to Responses API input.
func convertToResponsesInput(messages []ChatMessage) (string, []responsesInput) {
	var instructions string
	var input []responsesInput

	for _, m := range messages {
		switch m.Role {
		case "system":
			instructions = m.Content
		case "user":
			input = append(input, responsesInput{Role: "user", Content: m.Content})
		case "assistant":
			if len(m.ToolCalls) > 0 {
				// Assistant message with tool calls → function_call items
				for _, tc := range m.ToolCalls {
					input = append(input, responsesInput{
						Type:      "function_call",
						ID:        tc.ID,
						CallID:    tc.ID,
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					})
				}
			} else if m.Content != "" {
				input = append(input, responsesInput{Role: "assistant", Content: m.Content})
			}
		case "tool":
			// Tool result → function_call_output
			input = append(input, responsesInput{
				Type:   "function_call_output",
				CallID: m.ToolCallID,
				Output: m.Content,
			})
		}
	}

	return instructions, input
}

// convertToResponsesTools converts ToolDef to Responses API tools format.
func convertToResponsesTools(tools []ToolDef) []responsesTool {
	if len(tools) == 0 {
		return nil
	}
	out := make([]responsesTool, len(tools))
	for i, t := range tools {
		out[i] = responsesTool{
			Type:        "function",
			Name:        t.Function.Name,
			Description: t.Function.Description,
			Parameters:  t.Function.Parameters,
		}
	}
	return out
}

// convertResponsesToChatResponse converts a Responses API response to ChatResponse.
func convertResponsesToChatResponse(rResp responsesResponse) *ChatResponse {
	chatResp := &ChatResponse{
		Choices: []ChatChoice{{}},
	}

	var textParts []string
	var toolCalls []ToolCall

	for _, out := range rResp.Output {
		switch out.Type {
		case "message":
			for _, c := range out.Content {
				if c.Type == "output_text" {
					textParts = append(textParts, c.Text)
				}
			}
		case "function_call":
			callID := out.CallID
			if callID == "" {
				callID = out.ID
			}
			toolCalls = append(toolCalls, ToolCall{
				ID:   callID,
				Type: "function",
				Function: ToolCallFunc{
					Name:      out.Name,
					Arguments: out.Arguments,
				},
			})
		}
	}

	chatResp.Choices[0].Message = ChatMessage{
		Role:      "assistant",
		Content:   strings.Join(textParts, ""),
		ToolCalls: toolCalls,
	}

	if len(toolCalls) > 0 {
		chatResp.Choices[0].FinishReason = "tool_calls"
	} else {
		chatResp.Choices[0].FinishReason = "stop"
	}

	return chatResp
}
