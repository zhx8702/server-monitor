/** AI provider configuration, stored in Capacitor Preferences */
export interface AIConfig {
  provider: 'sub2api'
  apiKey: string
  endpoint: string // Sub2API gateway URL (required)
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

/** Suggested models */
export const SUGGESTED_MODELS = ['gpt-5.2', 'gpt-5.4', 'gpt-5.1']

/** Friendly display names for tool names */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_system_info: '系统信息',
  get_cpu_usage: 'CPU 使用率',
  get_memory_usage: '内存使用率',
  get_disk_usage: '磁盘使用',
  get_network_stats: '网络流量',
  get_top_processes: '进程列表',
  docker_list_containers: 'Docker 容器',
  docker_list_images: 'Docker 镜像',
  docker_container_action: '容器操作',
  docker_container_logs: '容器日志',
  docker_pull_image: '拉取镜像',
  docker_create_container: '创建容器',
  docker_remove_container: '删除容器',
  get_alert_rules: '告警规则',
  create_alert_rule: '创建告警',
  delete_alert_rule: '删除告警',
  get_alert_history: '告警历史',
}
