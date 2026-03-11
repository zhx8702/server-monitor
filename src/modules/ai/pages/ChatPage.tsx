import { useState, useRef, useEffect } from 'react'
import { Settings, Trash2, Send, Square, Bot, Wrench, History, Download, X, ChevronRight } from 'lucide-react'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAIConfig } from '../hooks/useAIConfig'
import { useAIChatContext, type ArchivedChat } from '../contexts/AIChatContext'
import { MessageBubble } from '../components/MessageBubble'
import { AIConfigSheet } from '../components/AIConfigSheet'
import { CLISetupDialog } from '../components/CLISetupDialog'

const CLI_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

const DEFAULT_SUGGESTIONS = [
  '查看系统状态',
  '列出 Docker 容器',
  '哪个进程最占CPU？',
  '部署一个 Redis 服务',
]

export function ChatPage() {
  const { config, updateConfig, isConfigured } = useAIConfig()
  const {
    messages, isProcessing, sendMessage, stopGeneration, clearMessages,
    frequentCommands, archives, deleteArchive, exportChat,
  } = useAIChatContext()
  const [input, setInput] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [viewingArchive, setViewingArchive] = useState<ArchivedChat | null>(null)
  const [cliReady, setCLIReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { getClient, activeServerId } = useServer()

  // Use frequent commands if available, otherwise defaults
  const suggestions = frequentCommands.length > 0 ? frequentCommands : DEFAULT_SUGGESTIONS

  // Reset cliReady when server changes
  useEffect(() => {
    setCLIReady(false)
  }, [activeServerId])

  // Auto-check CLI status; if installed but not configured, auto-configure
  useEffect(() => {
    if (!isConfigured || cliReady || !activeServerId) return
    const client = getClient()
    if (!client) return

    client.request<{ installed: boolean; configured: boolean }>(
      `/api/terminal/status?cmd=${config.cli}`
    ).then((status: { installed: boolean; configured: boolean }) => {
      if (status.installed && status.configured) {
        setCLIReady(true)
      } else if (status.installed && !status.configured) {
        client.post('/api/terminal/setup', {
          cmd: config.cli,
          action: 'configure',
          baseUrl: config.endpoint,
          apiKey: config.apiKey,
        }).then(() => setCLIReady(true))
          .catch(() => setShowSetup(true))
      }
    }).catch(() => {})
  }, [isConfigured, config.cli, cliReady, activeServerId, getClient, config.endpoint, config.apiKey])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    sendMessage(text, config)
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const canSend = isConfigured && cliReady

  // Viewing archived chat (read-only)
  if (viewingArchive) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-white/[0.06]">
          <button
            onClick={() => setViewingArchive(null)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-300 truncate flex-1">
            {viewingArchive.preview}
          </span>
          <button
            onClick={() => exportChat(viewingArchive.messages)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <Download className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {viewingArchive.messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Action bar */}
        {messages.length > 0 && (
          <div className="flex items-center justify-end gap-1 -mt-1 mb-1">
            <button
              onClick={() => exportChat()}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              <Download className="w-3 h-3" />
              导出
            </button>
            <button
              onClick={clearMessages}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              清空
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            {!isConfigured ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">请先配置 AI 助手</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">点击左下角设置按钮开始配置</p>
              </>
            ) : !cliReady ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  需要在服务器上设置 {CLI_LABELS[config.cli] || config.cli}
                </p>
                <button
                  onClick={() => setShowSetup(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                >
                  <Wrench className="w-4 h-4" />
                  设置 CLI 工具
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">有什么可以帮你的？</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-sm">
                  {suggestions.map(s => (
                    <button
                      key={s}
                      className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-dark-surface-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-dark-surface-3 border border-gray-200 dark:border-white/[0.06] transition-colors"
                      onClick={() => {
                        setInput(s)
                        inputRef.current?.focus()
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-gray-200 dark:border-white/[0.06] px-4 py-3 pb-safe-bottom">
        <div className="flex items-end gap-2">
          <button
            onClick={() => setShowConfig(true)}
            className="shrink-0 w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
          >
            <Settings className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          {archives.length > 0 && (
            <button
              onClick={() => setShowHistory(true)}
              className="shrink-0 w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
            >
              <History className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={canSend ? '输入消息...' : '请先完成配置'}
            disabled={!canSend}
            rows={1}
            className="flex-1 bg-white dark:bg-dark-surface-2 border border-gray-200 dark:border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none focus:outline-none focus:border-emerald-500 disabled:opacity-50 max-h-[120px]"
          />
          {isProcessing ? (
            <button
              onClick={stopGeneration}
              className="shrink-0 w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center hover:bg-rose-500 transition-colors"
            >
              <Square className="w-4 h-4 text-white fill-white" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !canSend}
              className="shrink-0 w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Config sheet */}
      {showConfig && (
        <AIConfigSheet
          config={config}
          onSave={(updates) => {
            const cliChanged = updates.cli && updates.cli !== config.cli
            updateConfig(updates)
            if (cliChanged) setCLIReady(false)
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {/* CLI Setup Dialog */}
      {showSetup && (
        <CLISetupDialog
          cli={config.cli}
          config={config}
          onReady={() => {
            setShowSetup(false)
            setCLIReady(true)
          }}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {/* History drawer */}
      {showHistory && (
        <HistoryDrawer
          archives={archives}
          onView={(a) => { setViewingArchive(a); setShowHistory(false) }}
          onExport={(a) => exportChat(a.messages)}
          onDelete={deleteArchive}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

// --- History Drawer ---

function HistoryDrawer({ archives, onView, onExport, onDelete, onClose }: {
  archives: ArchivedChat[]
  onView: (a: ArchivedChat) => void
  onExport: (a: ArchivedChat) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  // Group archives by date
  const groups = groupByDate(archives)

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Drawer */}
      <div className="relative ml-auto w-80 max-w-[85vw] h-full bg-white dark:bg-dark-surface-1 shadow-xl flex flex-col animate-slide-in-right">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/[0.06]">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">历史记录</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400 dark:text-gray-500">
              暂无历史记录
            </div>
          ) : (
            groups.map(group => (
              <div key={group.label}>
                <div className="px-4 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-white/[0.02]">
                  {group.label}
                </div>
                {group.items.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer border-b border-gray-100 dark:border-white/[0.04]"
                    onClick={() => onView(a)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{a.preview}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {new Date(a.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        {' '}· {a.messageCount} 条消息
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onExport(a) }}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-white/[0.08]"
                      >
                        <Download className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(a.id) }}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-white/[0.08]"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function groupByDate(archives: ArchivedChat[]) {
  const today = new Date()
  const todayStr = dateKey(today)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = dateKey(yesterday)

  const groups: { label: string; items: ArchivedChat[] }[] = []
  const map = new Map<string, ArchivedChat[]>()

  for (const a of archives) {
    const key = dateKey(new Date(a.timestamp))
    const arr = map.get(key) || []
    arr.push(a)
    map.set(key, arr)
  }

  for (const [key, items] of map) {
    let label = key
    if (key === todayStr) label = '今天'
    else if (key === yesterdayStr) label = '昨天'
    groups.push({ label, items })
  }

  return groups
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
