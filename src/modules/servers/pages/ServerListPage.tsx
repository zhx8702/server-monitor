import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useServer } from '../../../core/contexts/ServerContext'
import { useToast } from '../../../core/contexts/ToastContext'
import { useAppUpdate, isNewer } from '../../../core/hooks/useAppUpdate'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { EmptyState } from '../../../core/components/EmptyState'
import { ConfirmDialog } from '../../../core/components/ConfirmDialog'
import { AgentClient } from '../../../core/api/agent-client'
import { Server, Plus, Pencil, Trash2, Wifi, WifiOff, Download, RefreshCw, ArrowUpCircle } from 'lucide-react'
import type { ServerConfig, AgentInfo } from '../../../core/types/server'

export function ServerListPage() {
  const { servers, activeServerId, setActiveServer, removeServer } = useServer()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [healthMap, setHealthMap] = useState<Record<string, boolean>>({})
  const [versionMap, setVersionMap] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<ServerConfig | null>(null)
  const [updating, setUpdating] = useState<Record<string, boolean>>({})

  const { data: appUpdate } = useAppUpdate()
  const latestTag = appUpdate?.latestVersion ?? ''

  useEffect(() => {
    checkAllHealth()
  }, [servers]) // eslint-disable-line react-hooks/exhaustive-deps

  async function checkAllHealth() {
    const hResults: Record<string, boolean> = {}
    const vResults: Record<string, string> = {}
    await Promise.allSettled(
      servers.map(async (s) => {
        const client = new AgentClient(s)
        const ok = await client.healthCheck()
        hResults[s.id] = ok
        if (ok) {
          try {
            const info = await client.request<AgentInfo>('/api/info')
            vResults[s.id] = info.version
          } catch { /* ignore */ }
        }
      })
    )
    setHealthMap(hResults)
    setVersionMap(vResults)
  }

  const outdatedServers = latestTag
    ? servers.filter(s => versionMap[s.id] && isNewer(versionMap[s.id], latestTag))
    : []

  async function handleBatchUpdate() {
    const targets = outdatedServers.filter(s => healthMap[s.id])
    if (targets.length === 0) return

    const newUpdating: Record<string, boolean> = {}
    targets.forEach(s => { newUpdating[s.id] = true })
    setUpdating(newUpdating)

    let success = 0
    let failed = 0
    await Promise.allSettled(
      targets.map(async (s) => {
        try {
          const client = new AgentClient(s)
          await client.post('/api/update/apply', {})
          success++
        } catch {
          failed++
        } finally {
          setUpdating(prev => ({ ...prev, [s.id]: false }))
        }
      })
    )

    if (failed === 0) {
      toast(`${success} 台 Agent 已更新，正在重启...`, 'success')
    } else {
      toast(`${success} 台成功，${failed} 台失败`, 'error')
    }

    // Re-check after a short delay for restart
    setTimeout(checkAllHealth, 3000)
  }

  async function handleSingleUpdate(server: ServerConfig) {
    setUpdating(prev => ({ ...prev, [server.id]: true }))
    try {
      const client = new AgentClient(server)
      await client.post('/api/update/apply', {})
      toast(`${server.name} 已更新，正在重启...`, 'success')
    } catch (err) {
      toast(`${server.name} 更新失败: ${err instanceof Error ? err.message : '未知错误'}`, 'error')
    } finally {
      setUpdating(prev => ({ ...prev, [server.id]: false }))
      setTimeout(checkAllHealth, 3000)
    }
  }

  function handleSelect(server: ServerConfig) {
    setActiveServer(server.id)
    navigate('/dashboard')
  }

  function handleDelete() {
    if (!deleteTarget) return
    removeServer(deleteTarget.id)
    toast(`${deleteTarget.name} 已删除`, 'success')
    setDeleteTarget(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">服务器管理</h2>
        <button
          onClick={() => navigate('/servers/add')}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-emerald-500 text-white active:bg-emerald-600 transition-colors"
        >
          <Plus size={14} />
          添加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <PullToRefresh onRefresh={checkAllHealth}>
          <div className="p-4 pt-0 space-y-3 pb-6">

            {/* Batch Update Banner */}
            {outdatedServers.length > 0 && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20 animate-fade-in">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle size={16} className="text-amber-500" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {outdatedServers.length} 台服务器有新版本
                  </span>
                </div>
                <button
                  onClick={handleBatchUpdate}
                  disabled={Object.values(updating).some(Boolean)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500 text-white active:scale-95 transition-transform disabled:opacity-50"
                >
                  {Object.values(updating).some(Boolean) ? (
                    <><RefreshCw size={12} className="animate-spin" /><span>更新中...</span></>
                  ) : (
                    <><Download size={12} /><span>全部更新</span></>
                  )}
                </button>
              </div>
            )}

            {servers.length === 0 ? (
              <EmptyState
                icon={<Server size={48} />}
                title="暂无服务器"
                description="点击右上角添加你的第一台服务器"
                action={
                  <button
                    onClick={() => navigate('/servers/add')}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white active:bg-emerald-600 transition-colors"
                  >
                    添加服务器
                  </button>
                }
              />
            ) : (
              servers.map(server => {
                const isActive = server.id === activeServerId
                const isOnline = healthMap[server.id]
                const version = versionMap[server.id]
                const needsUpdate = version && latestTag && isNewer(version, latestTag)
                const isUpdating = updating[server.id]
                return (
                  <div
                    key={server.id}
                    onClick={() => handleSelect(server)}
                    className={`bg-white dark:bg-dark-surface-2 border rounded-2xl p-4 active:scale-[0.98] transition-all cursor-pointer ${
                      isActive
                        ? 'border-emerald-500/30 dark:border-emerald-500/20 shadow-sm shadow-emerald-500/10'
                        : 'border-gray-100 dark:border-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isOnline ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-gray-100 dark:bg-white/[0.06]'
                        }`}>
                          <Server size={16} className={isOnline ? 'text-emerald-500' : 'text-gray-400'} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{server.name}</span>
                            {server.group && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                {server.group}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{server.host}:{server.port}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isOnline !== undefined && (
                          isOnline ? (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                              <Wifi size={12} /> 在线
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] text-gray-400">
                              <WifiOff size={12} /> 离线
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    {/* Version Badge */}
                    {version && (
                      <div className="flex items-center gap-2 mb-2">
                        {needsUpdate ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-500/20">
                            <ArrowUpCircle size={10} />
                            {version} → {latestTag}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-emerald-50/50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/10">
                            {version}
                          </span>
                        )}
                        {needsUpdate && !isUpdating && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSingleUpdate(server) }}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-emerald-500 text-white active:scale-95 transition-transform"
                          >
                            <Download size={10} /> 更新
                          </button>
                        )}
                        {isUpdating && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                            <RefreshCw size={10} className="animate-spin" /> 更新中...
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/servers/edit/${server.id}`) }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-50 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-white/[0.08] transition-colors"
                      >
                        <Pencil size={12} /> 编辑
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(server) }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-rose-50 dark:bg-rose-500/10 text-rose-500 dark:text-rose-400 active:bg-rose-100 dark:active:bg-rose-500/20 transition-colors"
                      >
                        <Trash2 size={12} /> 删除
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </PullToRefresh>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除服务器"
        message={`确定要删除 "${deleteTarget?.name}" 吗？`}
        confirmLabel="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
