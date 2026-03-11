import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Download, CheckCircle, AlertCircle, Settings, Loader2 } from 'lucide-react'
import { useServer } from '../../../core/contexts/ServerContext'
import type { AIConfig } from '../types'

type SetupState =
  | 'checking'
  | 'not_installed'
  | 'installing'
  | 'install_failed'
  | 'has_config'
  | 'configure'
  | 'configuring'
  | 'ready'

interface Props {
  cli: AIConfig['cli']
  config: AIConfig
  onReady: () => void
  onCancel: () => void
}

const CLI_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

export function CLISetupDialog({ cli, config, onReady, onCancel }: Props) {
  const [state, setState] = useState<SetupState>('checking')
  const [errorMsg, setErrorMsg] = useState('')
  const [baseUrl, setBaseUrl] = useState(config.endpoint)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [outputLines, setOutputLines] = useState<string[]>([])
  const { getClient } = useServer()
  const outputRef = useRef<HTMLDivElement>(null)

  const cliLabel = CLI_LABELS[cli] || cli

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [outputLines])

  const checkStatus = useCallback(async () => {
    const client = getClient()
    if (!client) return

    setState('checking')
    try {
      const res = await client.request<{ installed: boolean; configured: boolean }>(
        '/api/terminal/status',
        { cmd: cli },
      )
      if (!res.installed) {
        setState('not_installed')
      } else if (res.configured) {
        setState('has_config')
      } else {
        setState('configure')
      }
    } catch {
      setState('not_installed')
    }
  }, [cli, getClient])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const handleInstall = async () => {
    const client = getClient()
    if (!client) return

    setState('installing')
    setOutputLines([])
    setErrorMsg('')

    try {
      const res = await client.postStream('/api/terminal/setup', {
        cmd: cli, action: 'install',
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'output') {
                setOutputLines(prev => [...prev, data.line])
              } else if (eventType === 'done') {
                if (data.success) {
                  setState('configure')
                } else {
                  setErrorMsg(data.message)
                  setState('install_failed')
                }
              }
            } catch {
              // skip malformed data
            }
            eventType = ''
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '安装失败')
      setState('install_failed')
    }
  }

  const handleConfigure = async () => {
    const client = getClient()
    if (!client) return

    setState('configuring')
    try {
      const res = await client.post<{ success: boolean; message: string }>(
        '/api/terminal/setup',
        { cmd: cli, action: 'configure', baseUrl, apiKey },
      )
      if (res.success) {
        setState('ready')
        setTimeout(onReady, 500)
      } else {
        setErrorMsg(res.message)
        setState('configure')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '配置失败')
      setState('configure')
    }
  }

  // Terminal-like output panel
  const OutputPanel = () => (
    outputLines.length > 0 ? (
      <div
        ref={outputRef}
        className="bg-[#1a1a2e] rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-gray-300 mt-3"
      >
        {outputLines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">{line || '\u00A0'}</div>
        ))}
      </div>
    ) : null
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onCancel} />

      <div className="relative w-full max-w-sm bg-white dark:bg-dark-surface rounded-2xl border border-gray-200 dark:border-white/[0.06] p-5 animate-scale-in">
        {/* Close */}
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06]"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>

        {/* Checking */}
        {state === 'checking' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">检测 {cliLabel} 状态...</p>
          </div>
        )}

        {/* Not Installed */}
        {state === 'not_installed' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center mb-3">
              <Download className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">{cliLabel} 未安装</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-5">
              需要在服务器上安装 {cliLabel} 才能使用
            </p>
            <div className="flex gap-2 w-full">
              <button
                onClick={onCancel}
                className="flex-1 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleInstall}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
              >
                自动安装
              </button>
            </div>
          </div>
        )}

        {/* Installing - with streaming output */}
        {state === 'installing' && (
          <div className="py-2">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin shrink-0" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">正在安装 {cliLabel}</h3>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">这可能需要几分钟</p>
            <OutputPanel />
          </div>
        )}

        {/* Install Failed - show output for debugging */}
        {state === 'install_failed' && (
          <div className="py-2">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">安装失败</h3>
            </div>
            {errorMsg && (
              <p className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2 mb-2">
                {errorMsg}
              </p>
            )}
            <OutputPanel />
            <div className="flex gap-2 mt-3">
              <button
                onClick={onCancel}
                className="flex-1 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
              >
                关闭
              </button>
              <button
                onClick={handleInstall}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        )}

        {/* Has Config */}
        {state === 'has_config' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mb-3">
              <CheckCircle className="w-6 h-6 text-emerald-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">检测到已有配置</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-5">
              {cliLabel} 已安装并配置，是否使用现有配置？
            </p>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => setState('configure')}
                className="flex-1 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
              >
                重新配置
              </button>
              <button
                onClick={onReady}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
              >
                保持现有
              </button>
            </div>
          </div>
        )}

        {/* Configure */}
        {state === 'configure' && (
          <div className="py-2">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">配置 {cliLabel}</h3>
            </div>

            {errorMsg && (
              <div className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2 mb-3">
                {errorMsg}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">网关地址 (Base URL)</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="http://192.168.1.x:8000/v1"
                  className="w-full bg-gray-50 dark:bg-dark-surface-2 border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-gray-50 dark:bg-dark-surface-2 border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={onReady}
                className="flex-1 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
              >
                跳过
              </button>
              <button
                onClick={handleConfigure}
                disabled={!baseUrl || !apiKey}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                保存并连接
              </button>
            </div>
          </div>
        )}

        {/* Configuring */}
        {state === 'configuring' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">正在写入配置...</p>
          </div>
        )}

        {/* Ready */}
        {state === 'ready' && (
          <div className="flex flex-col items-center py-8">
            <CheckCircle className="w-8 h-8 text-emerald-500 mb-3" />
            <p className="text-sm text-emerald-600 dark:text-emerald-400">配置完成</p>
          </div>
        )}
      </div>
    </div>
  )
}
