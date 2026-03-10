import { useState, useRef, useEffect } from 'react'
import { Settings, Trash2, Send, Square, Bot } from 'lucide-react'
import { useAIConfig } from '../hooks/useAIConfig'
import { useAIChat } from '../hooks/useAIChat'
import { MessageBubble } from '../components/MessageBubble'
import { AIConfigSheet } from '../components/AIConfigSheet'
import { CLISetupDialog } from '../components/CLISetupDialog'

const SUGGESTIONS = [
  '查看系统状态',
  '列出 Docker 容器',
  '哪个进程最占CPU？',
  '部署一个 Redis 服务',
]

export function ChatPage() {
  const { config, updateConfig, isConfigured } = useAIConfig()
  const { messages, isProcessing, sendMessage, stopGeneration, clearMessages } = useAIChat(config)
  const [input, setInput] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [cliReady, setCLIReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Show setup dialog when configured but CLI not yet checked
  useEffect(() => {
    if (isConfigured && !cliReady && !showSetup) {
      setShowSetup(true)
    }
  }, [isConfigured, cliReady, showSetup])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    sendMessage(text)
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

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Action bar */}
        {messages.length > 0 && (
          <div className="flex items-center justify-end gap-1 -mt-1 mb-1">
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
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">正在检测 CLI 工具...</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">请完成 CLI 设置后开始对话</p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">有什么可以帮你的？</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-sm">
                  {SUGGESTIONS.map(s => (
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
            updateConfig(updates)
            setCLIReady(false)
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
    </div>
  )
}
