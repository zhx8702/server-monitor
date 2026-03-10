import { useState, useRef, useEffect } from 'react'
import { Settings, Trash2, Send, Square, Bot } from 'lucide-react'
import { useAIConfig } from '../hooks/useAIConfig'
import { useAIChat } from '../hooks/useAIChat'
import { MessageBubble } from '../components/MessageBubble'
import { AIConfigSheet } from '../components/AIConfigSheet'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    sendMessage(text)
    // Reset textarea height
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
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
        <button
          onClick={clearMessages}
          disabled={messages.length === 0}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 transition-colors"
        >
          <Trash2 className="w-4.5 h-4.5" />
        </button>
        <h1 className="text-sm font-semibold text-zinc-200">AI 助手</h1>
        <button
          onClick={() => setShowConfig(true)}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-emerald-400" />
            </div>
            {!isConfigured ? (
              <>
                <p className="text-sm text-zinc-400 mb-2">请先配置 AI 模型</p>
                <button
                  onClick={() => setShowConfig(true)}
                  className="text-sm text-emerald-400 hover:text-emerald-300"
                >
                  打开配置
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-zinc-400 mb-4">有什么可以帮你的？</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-sm">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
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
      <div className="shrink-0 border-t border-zinc-800 px-4 py-3 pb-safe-bottom">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isConfigured ? '输入消息...' : '请先配置 AI 模型'}
            disabled={!isConfigured}
            rows={1}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-emerald-500 disabled:opacity-50 max-h-[120px]"
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
              disabled={!input.trim() || !isConfigured}
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
          onSave={updateConfig}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  )
}
