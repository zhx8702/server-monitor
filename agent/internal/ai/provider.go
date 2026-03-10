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
	"time"
)

// DefaultEndpoint returns the default API base URL for each provider.
func DefaultEndpoint(provider string) string {
	switch provider {
	case "openai":
		return "https://api.openai.com/v1"
	case "gemini":
		return "https://generativelanguage.googleapis.com/v1beta/openai"
	case "claude":
		return "https://api.anthropic.com/v1"
	default:
		return ""
	}
}

// Provider calls an OpenAI-compatible LLM API.
type Provider struct {
	client *http.Client
}

// NewProvider creates a new LLM provider with a long timeout.
func NewProvider() *Provider {
	return &Provider{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// Chat sends a non-streaming chat completion request and returns the full response.
func (p *Provider) Chat(ctx context.Context, cfg ProviderConfig, req ChatRequest) (*ChatResponse, error) {
	// Claude and Sub2API use the Anthropic Messages API format
	if cfg.Provider == "claude" || cfg.Provider == "sub2api" {
		return p.chatClaude(ctx, cfg, req)
	}

	req.Stream = false

	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint(cfg.Provider)
	}
	if endpoint == "" {
		return nil, fmt.Errorf("no endpoint configured for provider %q", cfg.Provider)
	}

	url := strings.TrimRight(endpoint, "/") + "/chat/completions"

	body, err := json.Marshal(req)
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
		return nil, fmt.Errorf("LLM API call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read LLM response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp ChatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		preview := string(respBody)
		if len(preview) > 300 {
			preview = preview[:300] + "..."
		}
		return nil, fmt.Errorf("decode LLM response (got: %s): %w", preview, err)
	}

	return &chatResp, nil
}

// StreamCallback is called for each streamed delta from the LLM.
type StreamCallback func(delta string, done bool) error

// ChatStream sends a streaming chat completion request and calls the callback
// for each content delta. Used for the final response (no tool calls).
func (p *Provider) ChatStream(ctx context.Context, cfg ProviderConfig, req ChatRequest, callback StreamCallback) error {
	// Claude and Sub2API use a different streaming format
	if cfg.Provider == "claude" || cfg.Provider == "sub2api" {
		return p.chatStreamClaude(ctx, cfg, req, callback)
	}

	req.Stream = true

	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint(cfg.Provider)
	}
	if endpoint == "" {
		return fmt.Errorf("no endpoint configured for provider %q", cfg.Provider)
	}

	url := strings.TrimRight(endpoint, "/") + "/chat/completions"

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	// Use a client without timeout for streaming
	streamClient := &http.Client{}
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("LLM streaming call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("LLM API returned %d: %s", resp.StatusCode, string(respBody))
	}

	// Read SSE stream from LLM
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			return callback("", true)
		}

		var chunk ChatResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue // skip malformed chunks
		}

		if len(chunk.Choices) > 0 {
			content := chunk.Choices[0].Delta.Content
			if content != "" {
				if err := callback(content, false); err != nil {
					return err
				}
			}
		}
	}

	return scanner.Err()
}
