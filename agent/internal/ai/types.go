package ai

import "encoding/json"

// ProviderConfig is sent from the frontend with each request.
type ProviderConfig struct {
	Provider string `json:"provider"` // "openai", "gemini", "claude"
	APIKey   string `json:"apiKey"`
	Endpoint string `json:"endpoint"` // custom endpoint URL (optional)
	Model    string `json:"model"`    // e.g. "gpt-4o", "gemini-2.0-flash"
}

// ChatAPIRequest is the top-level request body for POST /api/ai/chat.
type ChatAPIRequest struct {
	Provider ProviderConfig `json:"provider"`
	Messages []ChatMessage  `json:"messages"`
}

// ChatMessage represents a message in the OpenAI conversation format.
type ChatMessage struct {
	Role       string     `json:"role"`                  // "system", "user", "assistant", "tool"
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"` // for tool role
}

// ToolCall represents an assistant's request to call a tool.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // "function"
	Function ToolCallFunc `json:"function"`
}

// ToolCallFunc holds the function name and arguments for a tool call.
type ToolCallFunc struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// ToolDef describes a tool in OpenAI Function Calling format.
type ToolDef struct {
	Type     string      `json:"type"` // always "function"
	Function FunctionDef `json:"function"`
}

// FunctionDef is the function description within a tool definition.
type FunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"` // JSON Schema object
}

// ChatRequest is the request body to the OpenAI-compatible LLM API.
type ChatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Tools    []ToolDef     `json:"tools,omitempty"`
	Stream   bool          `json:"stream"`
}

// ChatResponse is the non-streaming response from the LLM.
type ChatResponse struct {
	Choices []ChatChoice `json:"choices"`
}

// ChatChoice represents a single choice in the LLM response.
type ChatChoice struct {
	Message      ChatMessage `json:"message"`
	Delta        ChatMessage `json:"delta"`
	FinishReason string      `json:"finish_reason"`
}

// SSEEventType defines the types of SSE events sent to the frontend.
type SSEEventType string

const (
	SSEToolCall     SSEEventType = "tool_call"
	SSEToolResult   SSEEventType = "tool_result"
	SSEContentDelta SSEEventType = "content_delta"
	SSEDone         SSEEventType = "done"
	SSEError        SSEEventType = "error"
)

// SSEToolCallData is the data for a tool_call SSE event.
type SSEToolCallData struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// SSEToolResultData is the data for a tool_result SSE event.
type SSEToolResultData struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Result string `json:"result"`
	Error  string `json:"error,omitempty"`
}
