/** AI CLI tool configuration, stored in Capacitor Preferences */
export interface AIConfig {
  cli: 'claude' | 'codex'
  apiKey: string
  endpoint: string // Sub2API gateway URL
  model: string
}

/** A message in the conversation */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: ToolCallInfo[]
  isStreaming?: boolean
}

/** Tool call information for rendering */
export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
  result?: string
  error?: string
  status: 'pending' | 'running' | 'done' | 'error'
}

/** SSE event types from backend */
export type SSEEventType = 'tool_call' | 'tool_result' | 'content_delta' | 'done' | 'error'

export interface SSEToolCallData {
  id: string
  name: string
  arguments: string
}

export interface SSEToolResultData {
  id: string
  name: string
  result: string
  error?: string
}

/** Suggested models by CLI type */
export const SUGGESTED_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250115'],
  codex: ['gpt-5.2', 'gpt-5.4', 'gpt-5.1'],
}

/** Friendly display names for tool names */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Read: '读取文件',
  Write: '写入文件',
  Edit: '编辑文件',
  Bash: '执行命令',
  Glob: '搜索文件',
  Grep: '搜索内容',
  WebFetch: '网页请求',
  WebSearch: '网页搜索',
  TodoWrite: '任务列表',
}
