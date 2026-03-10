import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { DetailSkeleton } from '../../../core/components/Skeleton'
import { formatBytes, formatUptime, usageColor } from '../../../core/utils'
import type { SystemInfo, CpuData, MemoryData, AgentInfo, UpdateCheckResult } from '../../../core/types/server'
import {
  MonitorCog, Cpu, MemoryStick, Thermometer,
  Clock, Shield, ChevronRight, Bell, Download, RefreshCw, Check, PackageOpen,
} from 'lucide-react'

export function SystemDetailPage() {
  const { activeServerId, getClient } = useServer()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: system, isLoading, error, refetch } = useAgentQuery<SystemInfo>('/api/system', undefined, { staleTime: 60_000 })
  const { data: cpu } = useAgentQuery<CpuData>('/api/cpu', undefined, { refetchInterval: 5_000 })
  const { data: memory } = useAgentQuery<MemoryData>('/api/memory', undefined, { refetchInterval: 5_000 })
  const { data: agentInfo } = useAgentQuery<AgentInfo>('/api/info', undefined, { staleTime: 120_000 })

  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null)

  const checkMutation = useMutation({
    mutationFn: async () => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.request<UpdateCheckResult>('/api/update/check')
    },
    onSuccess: (data) => setUpdateCheck(data),
  })

  const applyMutation = useMutation({
    mutationFn: async () => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.post<{ status: string }>('/api/update/apply', {})
    },
  })

  const cpuUsage = cpu?.current?.total_percent ?? 0
  const memUsage = memory?.current?.usage_percent ?? 0

  if (isLoading) return <DetailSkeleton />
  if (error && !system) return <QueryErrorState message="加载系统信息失败" onRetry={() => refetch()} />

  return (
    <div className="h-full flex flex-col">
      <PullToRefresh onRefresh={() => {
        queryClient.invalidateQueries({ queryKey: ['agent', activeServerId] })
      }}>
        <div className="p-4 pb-6 space-y-3">

          {/* Server Info Card */}
          {system && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-fade-in">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                  <MonitorCog size={20} className="text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{system.hostname}</h3>
                  <span className="text-xs text-gray-400">{system.os_name || system.platform} · {system.virtualization || '未知'}</span>
                </div>
              </div>
              {/* Tags - first row plain, second row green-tinted */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: '系统', value: system.os, tinted: false },
                  { label: '平台', value: system.platform, tinted: false },
                  { label: '架构', value: system.arch, tinted: true },
                  { label: '虚拟化', value: system.virtualization || 'none', tinted: true },
                ].map(tag => (
                  <span
                    key={tag.label}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-md border ${
                      tag.tinted
                        ? 'bg-emerald-50/50 dark:bg-[#0f2428] text-gray-500 dark:text-gray-400 border-emerald-100 dark:border-emerald-500/10'
                        : 'bg-gray-50 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 border-gray-100 dark:border-white/[0.06]'
                    }`}
                  >
                    {tag.label} <strong className={tag.tinted ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-200'}>{tag.value}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Status & Performance */}
          <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-emerald-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">状态与性能</h3>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                正常
              </span>
            </div>

            <div className="mb-3">
              <h4 className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">通知状态正常</h4>
              <p className="text-[11px] text-gray-400">当前没有活跃告警，通知通道已就绪</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">活跃告警</div>
                <div className="text-lg font-bold tabular-nums text-emerald-500">0</div>
              </div>
              <div className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">告警数量</div>
                <div className="text-lg font-bold tabular-nums text-emerald-500">0</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-4">
              <Bell size={12} />
              <span>建议保留至少一条关键指标告警规则</span>
            </div>

            {/* Performance Overview */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400">性能概览</span>
              <button
                onClick={() => navigate('/dashboard/alerts')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:scale-95 transition-transform"
              >
                <Bell size={12} /> 告警设置
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div
                className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 active:scale-[0.97] transition-transform cursor-pointer"
                onClick={() => navigate('/dashboard/cpu')}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Cpu size={12} className="text-emerald-500" />
                  <span className="text-xs text-gray-400">CPU</span>
                  <ChevronRight size={12} className="text-gray-300 dark:text-gray-600 ml-auto" />
                </div>
                <span className={`text-2xl font-bold tabular-nums ${usageColor(cpuUsage)}`}>
                  {Math.round(cpuUsage)}%
                </span>
                {system && (
                  <div className="text-[10px] text-gray-400 mt-1">
                    {system.cpu_logical} 核 · {system.cpu_mhz ? `${(system.cpu_mhz / 1000).toFixed(1)} GHz` : ''}
                  </div>
                )}
              </div>

              <div
                className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 active:scale-[0.97] transition-transform cursor-pointer"
                onClick={() => navigate('/dashboard/memory')}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <MemoryStick size={12} className="text-emerald-500" />
                  <span className="text-xs text-gray-400">内存</span>
                  <ChevronRight size={12} className="text-gray-300 dark:text-gray-600 ml-auto" />
                </div>
                <span className={`text-2xl font-bold tabular-nums ${usageColor(memUsage)}`}>
                  {Math.round(memUsage)}%
                </span>
                {memory && (
                  <div className="text-[10px] text-gray-400 mt-1">
                    已用 {formatBytes(memory.current?.used_bytes ?? 0)} / 总计 {formatBytes(memory.current?.total_bytes ?? 0)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Detail Stats */}
          {system && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <Thermometer size={14} className="text-emerald-500 mx-auto mb-1" />
                  <div className="text-[10px] text-gray-400">温度</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 tabular-nums">0°C</div>
                </div>
                <div className="text-center">
                  <span className="text-[10px] text-gray-400 block">Buffer</span>
                  <div className="text-sm font-bold text-teal-600 dark:text-teal-400 tabular-nums mt-1">
                    {memory ? formatBytes(memory.current?.buffers_bytes ?? 0) : '-'}
                  </div>
                </div>
                <div className="text-center">
                  <span className="text-[10px] text-gray-400 block">Cache</span>
                  <div className="text-sm font-bold text-gray-500 dark:text-gray-300 tabular-nums mt-1">
                    {memory ? formatBytes(memory.current?.cached_bytes ?? 0) : '-'}
                  </div>
                </div>
                <div className="text-center">
                  <Clock size={14} className="text-amber-500 mx-auto mb-1" />
                  <div className="text-[10px] text-gray-400">线程</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 tabular-nums">
                    {cpu?.current?.threads ?? '-'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Uptime */}
          {system && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
              <div className="flex items-center gap-3">
                <Clock size={16} className="text-emerald-500" />
                <div>
                  <div className="text-xs text-gray-400">运行时间</div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{formatUptime(system.uptime_seconds)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Agent Version & Update */}
          {agentInfo && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
              <div className="flex items-center gap-2 mb-3">
                <PackageOpen size={16} className="text-emerald-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Agent 版本</h3>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                <span className="px-2.5 py-1 text-[10px] font-medium rounded-md border bg-emerald-50/50 dark:bg-[#0f2428] text-gray-500 dark:text-gray-400 border-emerald-100 dark:border-emerald-500/10">
                  版本 <strong className="text-emerald-700 dark:text-emerald-400">{agentInfo.version}</strong>
                </span>
                <span className="px-2.5 py-1 text-[10px] font-medium rounded-md border bg-gray-50 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 border-gray-100 dark:border-white/[0.06]">
                  Commit <strong className="text-gray-700 dark:text-gray-200">{agentInfo.commit}</strong>
                </span>
                {agentInfo.buildTime && agentInfo.buildTime !== 'unknown' && (
                  <span className="px-2.5 py-1 text-[10px] font-medium rounded-md border bg-gray-50 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 border-gray-100 dark:border-white/[0.06]">
                    构建 <strong className="text-gray-700 dark:text-gray-200">{new Date(agentInfo.buildTime).toLocaleDateString()}</strong>
                  </span>
                )}
              </div>

              {/* Update Check */}
              {applyMutation.isSuccess ? (
                <div key="success" className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-500/10">
                  <Check size={14} className="text-emerald-500" />
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">更新已应用，Agent 正在重启...</span>
                </div>
              ) : updateCheck?.updateAvailable ? (
                <div key="available" className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/50 dark:bg-amber-500/10">
                    <div>
                      <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        发现新版本 {updateCheck.latestVersion}
                      </div>
                      {updateCheck.publishedAt && (
                        <div className="text-[10px] text-amber-600/60 dark:text-amber-400/60 mt-0.5">
                          发布于 {new Date(updateCheck.publishedAt).toLocaleDateString()}
                          {updateCheck.assetSize ? ` · ${formatBytes(updateCheck.assetSize)}` : ''}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => applyMutation.mutate()}
                      disabled={applyMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500 text-white active:scale-95 transition-transform disabled:opacity-50"
                    >
                      {applyMutation.isPending ? (
                        <><RefreshCw size={12} className="animate-spin" /><span>更新中...</span></>
                      ) : (
                        <><Download size={12} /><span>立即更新</span></>
                      )}
                    </button>
                  </div>
                  {applyMutation.error && (
                    <div className="text-[11px] text-red-500 px-1">更新失败: {applyMutation.error.message}</div>
                  )}
                </div>
              ) : updateCheck && !updateCheck.updateAvailable ? (
                <div key="latest" className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50/30 dark:bg-[#0f2428]">
                  <Check size={14} className="text-emerald-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">已是最新版本</span>
                </div>
              ) : (
                <button
                  key="check"
                  onClick={() => checkMutation.mutate()}
                  disabled={checkMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-50/30 dark:bg-[#0f2428] text-emerald-600 dark:text-emerald-400 active:scale-95 transition-transform disabled:opacity-50 w-full justify-center"
                >
                  {checkMutation.isPending ? (
                    <><RefreshCw size={13} className="animate-spin" /><span>检查中...</span></>
                  ) : (
                    <><RefreshCw size={13} /><span>检查更新</span></>
                  )}
                </button>
              )}
              {checkMutation.error && !updateCheck && (
                <div className="text-[11px] text-red-500 mt-2 px-1">
                  {checkMutation.error.message.includes('github_repo')
                    ? 'Agent 未配置 GitHub 仓库地址 (SM_GITHUB_REPO)'
                    : `检查失败: ${checkMutation.error.message}`}
                </div>
              )}
            </div>
          )}

        </div>
      </PullToRefresh>
    </div>
  )
}
