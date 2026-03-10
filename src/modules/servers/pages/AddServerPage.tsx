import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useServer } from '../../../core/contexts/ServerContext'
import { useToast } from '../../../core/contexts/ToastContext'
import { AgentClient } from '../../../core/api/agent-client'
import { Loader2, CheckCircle, XCircle, ChevronDown, Copy, Check, Terminal, Rocket } from 'lucide-react'

const isDev = import.meta.env.DEV

function generateToken() {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

export function AddServerPage() {
  const { id } = useParams<{ id: string }>()
  const { servers, addServer, updateServer } = useServer()
  const { toast } = useToast()
  const navigate = useNavigate()

  const editing = servers.find(s => s.id === id)

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('9090')
  const [token, setToken] = useState('')
  const [protocol, setProtocol] = useState<'http' | 'https'>('http')
  const [group, setGroup] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)
  const [deployOpen, setDeployOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // SSH deploy state
  const [deployHost, setDeployHost] = useState('')
  const [sshAuth, setSshAuth] = useState<'password' | 'key'>('password')
  const [sshPassword, setSshPassword] = useState('')
  const [sshKeyPath, setSshKeyPath] = useState('~/.ssh/id_rsa')
  const [deploying, setDeploying] = useState(false)
  const [deployLogs, setDeployLogs] = useState<string[]>([])
  const [deployResult, setDeployResult] = useState<{ success: boolean; message: string } | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) {
      setName(editing.name)
      setHost(editing.host)
      setPort(String(editing.port))
      setToken(editing.token)
      setProtocol(editing.protocol)
      setGroup(editing.group ?? '')
    }
  }, [editing])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [deployLogs])

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const client = new AgentClient({
        id: 'test',
        name, host, port: Number(port), token, protocol,
      })
      const ok = await client.healthCheck()
      setTestResult(ok)
    } catch {
      setTestResult(false)
    } finally {
      setTesting(false)
    }
  }

  function handleSave() {
    if (!name.trim() || !host.trim() || !token.trim()) {
      toast('请填写必要字段', 'error')
      return
    }
    if (editing) {
      updateServer(editing.id, {
        name: name.trim(),
        host: host.trim(),
        port: Number(port),
        token: token.trim(),
        protocol,
        group: group.trim() || undefined,
      })
      toast('服务器已更新', 'success')
    } else {
      addServer({
        name: name.trim(),
        host: host.trim(),
        port: Number(port),
        token: token.trim(),
        protocol,
        group: group.trim() || undefined,
      })
      toast('服务器已添加', 'success')
    }
    navigate('/servers')
  }

  // -- Deploy: copy command (production) --
  const INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/your-org/server-monitor/main/agent/scripts/install.sh'

  const installCommand = useCallback(() => {
    let cmd = `curl -sSL ${INSTALL_SCRIPT_URL} | SM_TOKEN=${token.trim() || '<your_token>'}`
    if (port && port !== '9090') cmd += ` SM_PORT=${port}`
    cmd += ' bash'
    return cmd
  }, [token, port])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(installCommand())
      setCopied(true)
      toast('已复制到剪贴板', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('复制失败', 'error')
    }
  }

  // -- Deploy: SSH (dev only) --
  const canDeploy = deployHost.trim() && (sshAuth === 'key' ? sshKeyPath.trim() : sshPassword.trim())

  async function handleDeploy() {
    if (!deployHost.trim()) {
      toast('请填写服务器地址', 'error')
      return
    }
    if (sshAuth === 'password' && !sshPassword.trim()) {
      toast('请填写 SSH 密码', 'error')
      return
    }

    // Auto-generate token
    const deployToken = generateToken()
    const deployPort = Number(port) || 9090

    setDeploying(true)
    setDeployLogs([])
    setDeployResult(null)

    let success = false
    let finalToken = deployToken
    let finalPort = deployPort

    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: deployHost.trim(),
          smToken: deployToken,
          smPort: deployPort,
          ...(sshAuth === 'key'
            ? { sshKeyPath: sshKeyPath.trim() }
            : { sshPassword }),
        }),
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return
        try {
          const data = JSON.parse(line.slice(6))
          if (typeof data === 'object' && data !== null && 'success' in data) {
            setDeployResult(data)
            success = data.success
            // If agent was already installed, use existing token/port
            if (data.existingToken) finalToken = data.existingToken
            if (data.existingPort) finalPort = Number(data.existingPort)
          } else if (typeof data === 'string') {
            setDeployLogs(prev => [...prev, data])
          }
        } catch { /* skip */ }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        lines.forEach(processLine)
      }

      if (buffer) buffer.split('\n').forEach(processLine)
    } catch (err) {
      const message = err instanceof Error ? err.message : '部署失败'
      setDeployResult({ success: false, message })
    } finally {
      setDeploying(false)
    }

    // After successful deploy: populate main form fields
    if (success) {
      setHost(deployHost.trim())
      setToken(finalToken)
      setPort(String(finalPort))
      if (!name.trim()) setName(deployHost.trim())

      // Auto-test the connection
      setTesting(true)
      setTestResult(null)
      try {
        await new Promise(r => setTimeout(r, 1500))
        const client = new AgentClient({
          id: 'test', name: deployHost.trim(), host: deployHost.trim(),
          port: finalPort, token: finalToken, protocol,
        })
        const ok = await client.healthCheck()
        setTestResult(ok)
      } catch {
        setTestResult(false)
      } finally {
        setTesting(false)
      }

      setDeployOpen(false)
      const isSkipped = finalToken !== deployToken
      toast(isSkipped ? 'Agent 已是最新版本，信息已回填' : '部署成功，信息已回填，请确认后保存', 'success')
    }
  }

  const inputClass = 'w-full px-4 py-3 bg-white dark:bg-dark-surface-2 rounded-xl text-sm border border-gray-200 dark:border-white/[0.08] outline-none focus:ring-2 focus:ring-emerald-400/30 text-gray-900 dark:text-white placeholder-gray-400 transition-shadow'
  const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5'

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4 pb-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          {editing ? '编辑服务器' : '添加服务器'}
        </h2>

        {/* Server config */}
        <div className="space-y-3">
          <div>
            <label className={labelClass}>名称 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：洛杉矶" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>地址 *</label>
            <input value={host} onChange={e => setHost(e.target.value)} placeholder="IP 或域名" className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Agent 端口</label>
              <input value={port} onChange={e => setPort(e.target.value)} type="number" placeholder="9090" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>协议</label>
              <div className="flex rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                {(['http', 'https'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setProtocol(p)}
                    className={`flex-1 py-3 text-xs font-medium transition-colors ${
                      protocol === p
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white dark:bg-dark-surface-2 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Token *</label>
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="Agent 认证 Token（部署时可自动生成）" type="password" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>分组</label>
            <input value={group} onChange={e => setGroup(e.target.value)} placeholder="可选，如：香港、洛杉矶" className={inputClass} />
          </div>
        </div>

        {/* Deploy Agent (collapsible) */}
        {!editing && (
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
            <button
              onClick={() => setDeployOpen(!deployOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/[0.03] active:bg-gray-100 dark:active:bg-white/[0.06] transition-colors"
            >
              <span className="flex items-center gap-2">
                <Terminal size={14} />
                一键部署 Agent
              </span>
              <ChevronDown size={14} className={`transition-transform ${deployOpen ? 'rotate-180' : ''}`} />
            </button>
            {deployOpen && (
              <div className="px-4 py-3 space-y-3 border-t border-gray-200 dark:border-white/[0.08]">
                {isDev ? (
                  <>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      填写 SSH 信息，一键部署 Agent 到目标服务器，部署成功后自动回填连接信息
                    </p>
                    <div>
                      <label className={labelClass}>服务器地址</label>
                      <input
                        value={deployHost}
                        onChange={e => setDeployHost(e.target.value)}
                        placeholder="IP 或域名"
                        className={inputClass}
                      />
                    </div>
                    <div className="flex rounded-lg border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                      {(['password', 'key'] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setSshAuth(m)}
                          className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            sshAuth === m
                              ? 'bg-emerald-500 text-white'
                              : 'bg-white dark:bg-dark-surface-2 text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {m === 'password' ? '密码登录' : '密钥登录'}
                        </button>
                      ))}
                    </div>
                    {sshAuth === 'password' ? (
                      <input
                        value={sshPassword}
                        onChange={e => setSshPassword(e.target.value)}
                        type="password"
                        placeholder="SSH 密码"
                        className={inputClass}
                      />
                    ) : (
                      <input
                        value={sshKeyPath}
                        onChange={e => setSshKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_rsa"
                        className={inputClass}
                      />
                    )}
                    <button
                      onClick={handleDeploy}
                      disabled={deploying || !canDeploy}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white active:bg-emerald-600 transition-colors disabled:opacity-40"
                    >
                      <Loader2 size={14} className={`animate-spin ${deploying ? '' : 'hidden'}`} />
                      <Rocket size={14} className={deploying ? 'hidden' : ''} />
                      {deploying ? '部署中 ...' : '一键部署'}
                    </button>
                    {deployLogs.length > 0 && (
                      <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-900 dark:bg-black/40 p-3">
                        {deployLogs.map((log, i) => (
                          <div key={i} className="text-xs text-gray-300 font-mono leading-relaxed">{log}</div>
                        ))}
                        {deployResult && (
                          <div className={`text-xs font-medium mt-2 ${deployResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {deployResult.success ? '部署成功' : `失败: ${deployResult.message}`}
                          </div>
                        )}
                        <div ref={logsEndRef} />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      在目标服务器上以 root 执行以下命令，自动安装并启动 Agent：
                    </p>
                    <div className="relative">
                      <pre className="p-3 pr-10 bg-gray-900 dark:bg-black/40 rounded-lg text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                        {installCommand()}
                      </pre>
                      <button
                        onClick={handleCopy}
                        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 active:bg-white/25 transition-colors"
                        title="复制命令"
                      >
                        <Check size={13} className={`text-emerald-400 ${copied ? '' : 'hidden'}`} />
                        <Copy size={13} className={`text-gray-400 ${copied ? 'hidden' : ''}`} />
                      </button>
                    </div>
                    <ul className="text-xs text-gray-400 dark:text-gray-500 space-y-1">
                      <li>· 自动检测 amd64 / arm64 架构</li>
                      <li>· 注册为 systemd 服务并开机自启</li>
                      <li>· 卸载: 脚本末尾追加 <code className="text-gray-500 dark:text-gray-400">--uninstall</code></li>
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing || !host.trim() || !token.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 active:bg-gray-200 dark:active:bg-white/[0.1] transition-colors disabled:opacity-40"
          >
            {testing && <Loader2 size={14} className="animate-spin" />}
            测试连接
          </button>
          {testResult !== null && (
            testResult ? (
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <CheckCircle size={14} /> 连接成功
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-rose-500">
                <XCircle size={14} /> 连接失败
              </span>
            )
          )}
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-emerald-500 text-white active:bg-emerald-600 transition-colors shadow-sm shadow-emerald-500/25"
        >
          {editing ? '保存修改' : '添加服务器'}
        </button>
      </div>
    </div>
  )
}
