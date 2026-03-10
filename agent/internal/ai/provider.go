package ai

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Provider calls the Sub2API (OpenAI Responses API format) LLM endpoint.
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
// Retries automatically on transient errors (429, 502, 503).
func (p *Provider) Chat(ctx context.Context, cfg ProviderConfig, req ChatRequest) (*ChatResponse, error) {
	return p.chatWithRetry(ctx, cfg, req, 3)
}

func (p *Provider) chatWithRetry(ctx context.Context, cfg ProviderConfig, req ChatRequest, maxRetries int) (*ChatResponse, error) {
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(1<<(attempt-1)) * time.Second
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}
		resp, err := p.chatResponses(ctx, cfg, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if !isTransientError(err) {
			return nil, err
		}
	}
	return nil, lastErr
}

// StreamCallback is called for each streamed delta from the LLM.
type StreamCallback func(delta string, done bool) error

// ChatStream sends a streaming chat completion request and calls the callback
// for each content delta. Used for the final response (no tool calls).
func (p *Provider) ChatStream(ctx context.Context, cfg ProviderConfig, req ChatRequest, callback StreamCallback) error {
	return p.chatStreamResponses(ctx, cfg, req, callback)
}

// isTransientError checks if an error is a retryable transient HTTP error (429, 502, 503).
func isTransientError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, fmt.Sprintf("returned %d", 429)) ||
		strings.Contains(msg, fmt.Sprintf("returned %d", 502)) ||
		strings.Contains(msg, fmt.Sprintf("returned %d", 503))
}
