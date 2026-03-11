import { useRef, useCallback } from 'react'
import { useServer } from '../../../core/contexts/ServerContext'
import { TerminalView, type TerminalViewHandle } from '../components/TerminalView'

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
  const termRef = useRef<TerminalViewHandle>(null)

  const client = getClient()

  const handleDisconnect = useCallback(() => {
    // Terminal auto-reconnects; this is only called on permanent disconnect
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

  const wsUrl = client.getTerminalWsUrl('bash')

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e]">
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
