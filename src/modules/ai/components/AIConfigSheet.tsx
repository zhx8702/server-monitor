import { useState } from 'react'
import { X } from 'lucide-react'
import type { AIConfig } from '../types'
import { SUGGESTED_MODELS } from '../types'

interface Props {
  config: AIConfig
  onSave: (updates: Partial<AIConfig>) => void
  onClose: () => void
}

const CLI_OPTIONS: { value: AIConfig['cli']; label: string; desc: string }[] = [
  { value: 'claude', label: 'Claude Code', desc: 'Anthropic' },
  { value: 'codex', label: 'Codex CLI', desc: 'OpenAI' },
]

export function AIConfigSheet({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AIConfig>({ ...config })
  const [showKey, setShowKey] = useState(false)

  const handleCLIChange = (cli: AIConfig['cli']) => {
    const models = SUGGESTED_MODELS[cli] || []
    setDraft(prev => ({
      ...prev,
      cli,
      model: models[0] || prev.model,
    }))
  }

  const handleSave = () => {
    onSave(draft)
    onClose()
  }

  const models = SUGGESTED_MODELS[draft.cli] || []

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-white dark:bg-dark-surface rounded-t-2xl border-t border-gray-200 dark:border-white/[0.06] p-5 pb-safe-bottom animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">AI 配置</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="space-y-4">
          {/* CLI Selector */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">CLI 工具</label>
            <div className="grid grid-cols-2 gap-2">
              {CLI_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`flex flex-col items-center gap-0.5 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    draft.cli === opt.value
                      ? 'bg-emerald-50 dark:bg-emerald-600/20 border-emerald-400 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                      : 'bg-gray-50 dark:bg-dark-surface-2 border-gray-200 dark:border-white/[0.06] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-white/[0.1]'
                  }`}
                  onClick={() => handleCLIChange(opt.value)}
                >
                  <span>{opt.label}</span>
                  <span className="text-[10px] opacity-60">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Gateway URL */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">网关地址</label>
            <input
              type="text"
              value={draft.endpoint}
              onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))}
              placeholder="http://192.168.1.x:8000/v1"
              className="w-full bg-gray-50 dark:bg-dark-surface-2 border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={e => setDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="sk-..."
                className="w-full bg-gray-50 dark:bg-dark-surface-2 border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">模型</label>
            <input
              type="text"
              value={draft.model}
              onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))}
              placeholder="输入模型名称"
              className="w-full bg-gray-50 dark:bg-dark-surface-2 border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {models.map(m => (
                <button
                  key={m}
                  className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                    draft.model === m
                      ? 'bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-gray-100 dark:bg-dark-surface-2 text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                  onClick={() => setDraft(prev => ({ ...prev, model: m }))}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!draft.apiKey || !draft.model || !draft.endpoint}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}
