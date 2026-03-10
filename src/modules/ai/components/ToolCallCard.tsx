import { useState } from 'react'
import { Wrench, Check, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCallInfo } from '../types'
import { TOOL_DISPLAY_NAMES } from '../types'

export function ToolCallCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const displayName = TOOL_DISPLAY_NAMES[toolCall.name] || toolCall.name

  const statusIcon = {
    pending: <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />,
    running: <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />,
    done: <Check className="w-3.5 h-3.5 text-emerald-400" />,
    error: <X className="w-3.5 h-3.5 text-rose-400" />,
  }[toolCall.status]

  return (
    <div className="my-1.5 rounded-lg border border-zinc-700/50 bg-zinc-800/50 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-700/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="text-zinc-300 font-medium truncate">{displayName}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {statusIcon}
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          }
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {toolCall.arguments && toolCall.arguments !== '{}' && (
            <div>
              <div className="text-[11px] text-zinc-500 mb-0.5">参数</div>
              <pre className="text-xs text-zinc-400 bg-zinc-900/50 rounded p-2 overflow-x-auto max-h-32">
                {formatJSON(toolCall.arguments)}
              </pre>
            </div>
          )}
          {toolCall.result && (
            <div>
              <div className="text-[11px] text-zinc-500 mb-0.5">
                {toolCall.error ? '错误' : '结果'}
              </div>
              <pre className={`text-xs rounded p-2 overflow-x-auto max-h-48 ${
                toolCall.error
                  ? 'text-rose-300 bg-rose-950/30'
                  : 'text-zinc-400 bg-zinc-900/50'
              }`}>
                {formatJSON(toolCall.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatJSON(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}
