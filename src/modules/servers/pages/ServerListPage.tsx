import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useServer } from '../../../core/contexts/ServerContext'
import { useToast } from '../../../core/contexts/ToastContext'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { EmptyState } from '../../../core/components/EmptyState'
import { ConfirmDialog } from '../../../core/components/ConfirmDialog'
import { AgentClient } from '../../../core/api/agent-client'
import { Server, Plus, Pencil, Trash2, Wifi, WifiOff } from 'lucide-react'
import type { ServerConfig } from '../../../core/types/server'

export function ServerListPage() {
  const { servers, activeServerId, setActiveServer, removeServer } = useServer()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [healthMap, setHealthMap] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<ServerConfig | null>(null)

  useEffect(() => {
    checkAllHealth()
  }, [servers]) // eslint-disable-line react-hooks/exhaustive-deps

  async function checkAllHealth() {
    const results: Record<string, boolean> = {}
    await Promise.allSettled(
      servers.map(async (s) => {
        const client = new AgentClient(s)
        results[s.id] = await client.healthCheck()
      })
    )
    setHealthMap(results)
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
                    <div className="flex items-center gap-2 mt-2">
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
