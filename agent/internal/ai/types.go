package ai

// ChatAPIRequest is the request body for POST /api/ai/chat.
type ChatAPIRequest struct {
	CLI      string `json:"cli"`      // "claude" or "codex"
	APIKey   string `json:"apiKey"`
	Endpoint string `json:"endpoint"`
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
	ChatID   string `json:"chatId"`
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
