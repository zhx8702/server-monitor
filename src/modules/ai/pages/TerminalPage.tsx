import { useState, useRef, useCallback } from 'react'
import { TerminalSquare, ArrowLeft } from 'lucide-react'
import { useServer } from '../../../core/contexts/ServerContext'
import { TerminalView, type TerminalViewHandle } from '../components/TerminalView'
import { useAIConfig } from '../hooks/useAIConfig'
import { CLISetupDialog } from '../components/CLISetupDialog'
import type { AIConfig } from '../types'

const TERMINAL_MODES = [
  { id: 'bash', label: 'Bash', desc: '标准 Shell 终端' },
  { id: 'codex', label: 'Codex CLI', desc: 'OpenAI Codex 编程助手' },
  { id: 'claude', label: 'Claude Code', desc: 'Anthropic Claude 编程助手' },
] as const

const SPECIAL_KEYS = [
  { label: 'Esc', seq: '\x1b' },
  { label: 'Tab', seq: '\t' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Ctrl+Z', seq: '\x1a' },
  { label: '\u2191', seq: '\x1b[A' },
  { label: '\u2193', seq: '\x1b[B' },
  { label: '\u2190', seq: '\x1b[D' },
  { label: '\u2192', seq: '\x1b[C' },
]

export function TerminalPage() {
  const { getClient } = useServer()
  const { config } = useAIConfig()
  const [activeCmd, setActiveCmd] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [setupCmd, setSetupCmd] = useState<AIConfig['cli'] | null>(null)
  const termRef = useRef<TerminalViewHandle>(null)

  const client = getClient()

  const handleConnect = (cmd: string) => {
    // For codex/claude, show setup dialog first
    if (cmd === 'codex' || cmd === 'claude') {
      setSetupCmd(cmd)
      return
    }
    // Bash connects directly
    setActiveCmd(cmd)
    setConnected(true)
  }

  const handleSetupReady = () => {
    if (setupCmd) {
      setActiveCmd(setupCmd)
      setConnected(true)
      setSetupCmd(null)
    }
  }

  const handleDisconnect = useCallback(() => {
    setConnected(false)
    setActiveCmd(null)
  }, [])

  const handleSpecialKey = (seq: string) => {
    termRef.current?.sendInput(seq)
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        请先选择一个服务器
      </div>
    )
  }

  if (activeCmd && connected) {
    const wsUrl = client.getTerminalWsUrl(activeCmd, config.apiKey, config.endpoint)
    return (
      <div className="flex flex-col h-full bg-[#1a1a2e]">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#16162a] border-b border-white/[0.06]">
          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-lg hover:bg-white/[0.06]"
          >
            <ArrowLeft className="w-4 h-4 text-gray-400" />
          </button>
          <span className="text-sm font-medium text-gray-200">{activeCmd}</span>
          <span className="ml-auto text-xs text-emerald-400">connected</span>
        </div>

        {/* Terminal */}
        <div className="flex-1 overflow-hidden">
          <TerminalView ref={termRef} wsUrl={wsUrl} onDisconnect={handleDisconnect} />
        </div>

        {/* Mobile special keys toolbar */}
        <div className="shrink-0 flex gap-1.5 px-2 py-2 bg-[#16162a] border-t border-white/[0.06] overflow-x-auto">
          {SPECIAL_KEYS.map(k => (
            <button
              key={k.label}
              className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-xs font-mono text-gray-300 active:bg-white/[0.12] shrink-0"
              onClick={() => handleSpecialKey(k.seq)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Session launcher
  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <TerminalSquare className="w-12 h-12 text-emerald-500 mb-4" />
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">远程终端</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
        连接到服务器运�� Bash、Codex CLI 或 Claude Code
      </p>
      <div className="space-y-3 w-full max-w-xs">
        {TERMINAL_MODES.map(mode => (
          <button
            key={mode.id}
            onClick={() => handleConnect(mode.id)}
            className="w-full py-3.5 px-4 rounded-xl bg-gray-100 dark:bg-dark-surface-2 text-left hover:bg-gray-200 dark:hover:bg-dark-surface-3 transition-colors"
          >
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{mode.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{mode.desc}</div>
          </button>
        ))}
      </div>

      {/* CLI Setup Dialog */}
      {setupCmd && (
        <CLISetupDialog
          cli={setupCmd}
          config={config}
          onReady={handleSetupReady}
          onCancel={() => setSetupCmd(null)}
        />
      )}
    </div>
  )
}
