import { useState } from 'react'
import { X } from 'lucide-react'
import type { AIConfig } from '../types'
import { DEFAULT_ENDPOINTS, SUGGESTED_MODELS } from '../types'

interface Props {
  config: AIConfig
  onSave: (updates: Partial<AIConfig>) => void
  onClose: () => void
}

export function AIConfigSheet({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AIConfig>({ ...config })
  const [showKey, setShowKey] = useState(false)

  const handleProviderChange = (provider: AIConfig['provider']) => {
    setDraft(prev => ({
      ...prev,
      provider,
      model: SUGGESTED_MODELS[provider]?.[0] || '',
      endpoint: '',
    }))
  }

  const handleSave = () => {
    onSave(draft)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-zinc-900 rounded-t-2xl border-t border-zinc-700/50 p-5 pb-safe-bottom animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-zinc-100">AI 配置</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Provider */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">模型提供商</label>
            <div className="flex gap-2">
              {(['openai', 'gemini', 'claude'] as const).map(p => (
                <button
                  key={p}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    draft.provider === p
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                  onClick={() => handleProviderChange(p)}
                >
                  {p === 'openai' ? 'OpenAI' : p === 'gemini' ? 'Gemini' : 'Claude'}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={e => setDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="sk-..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">模型</label>
            <input
              type="text"
              value={draft.model}
              onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))}
              placeholder={SUGGESTED_MODELS[draft.provider]?.[0] || 'model-name'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
            />
            {SUGGESTED_MODELS[draft.provider] && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {SUGGESTED_MODELS[draft.provider].map(m => (
                  <button
                    key={m}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      draft.model === m
                        ? 'bg-emerald-600/30 text-emerald-400'
                        : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                    onClick={() => setDraft(prev => ({ ...prev, model: m }))}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Endpoint */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">
              自定义端点 <span className="text-zinc-600">（可选）</span>
            </label>
            <input
              type="text"
              value={draft.endpoint}
              onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))}
              placeholder={DEFAULT_ENDPOINTS[draft.provider] || 'https://...'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!draft.apiKey || !draft.model}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}
