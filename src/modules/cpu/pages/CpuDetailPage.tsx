import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { TimeSeriesChart } from '../../../core/components/TimeSeriesChart'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { DetailSkeleton, ChartSkeleton } from '../../../core/components/Skeleton'
import { usageColor } from '../../../core/utils'
import type { SystemInfo, CpuData } from '../../../core/types/server'
import { Clock, Activity } from 'lucide-react'

export function CpuDetailPage() {
  const { activeServerId } = useServer()
  const queryClient = useQueryClient()
  const [secondLevel, setSecondLevel] = useState(false)

  const { data: system } = useAgentQuery<SystemInfo>('/api/system', undefined, { staleTime: 60_000 })
  const { data: cpu, isLoading, error, refetch } = useAgentQuery<CpuData>(
    '/api/cpu',
    { history: 'true' },
    { refetchInterval: secondLevel ? 1_000 : 2_000 },
  )

  if (isLoading) return <DetailSkeleton />
  if (error && !cpu) return <QueryErrorState message="加载 CPU 数据失败" onRetry={() => refetch()} />

  const current = cpu?.current
  const usage = current?.total_percent ?? 0

  // Prepare chart data
  const usageData = cpu?.history?.usage?.map(p => ({ ts: p.ts, value: p.value })) ?? []
  const loadData = cpu?.history?.load?.map(p => ({ ts: p.ts, l1: p.l1, l5: p.l5, l15: p.l15 })) ?? []

  return (
    <div className="h-full flex flex-col">
      <PullToRefresh onRefresh={() => {
        queryClient.invalidateQueries({ queryKey: ['agent', activeServerId, '/api/cpu'] })
      }}>
        <div className="p-4 pb-6 space-y-3">

          {/* Second Level Toggle */}
          <div className="flex items-center justify-end">
            <button
              onClick={() => setSecondLevel(!secondLevel)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                secondLevel
                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/25'
                  : 'bg-white dark:bg-dark-surface-2 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/[0.08]'
              }`}
            >
              <Clock size={12} />
              秒级
            </button>
          </div>

          {/* CPU Overview Card */}
          <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-fade-in">
            <div className="mb-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">CPU 概览</h3>
              <p className="text-[11px] text-gray-400">核心负载平稳，适合继续观察趋势变化</p>
            </div>

            <div className="flex items-start gap-4 mt-3">
              {/* Big Percentage */}
              <div>
                <span className={`text-4xl font-bold tabular-nums ${usageColor(usage)}`}>
                  {Math.round(usage)}%
                </span>
                <div className="text-[10px] text-gray-400 mt-1">
                  当前总占用
                </div>
                {current && (
                  <div className="text-[10px] text-gray-400">
                    1m {current.load_1m.toFixed(1)} · 5m {current.load_5m.toFixed(1)} · 15m {current.load_15m.toFixed(1)}
                  </div>
                )}
              </div>

              {/* Info Grid - teal-tinted boxes */}
              <div className="flex-1 grid grid-cols-2 gap-2">
                <div className="bg-emerald-50/50 dark:bg-[#0f2428] rounded-lg p-2">
                  <div className="text-[10px] text-gray-400">逻辑核心</div>
                  <div className="text-sm font-bold text-teal-600 dark:text-teal-400 tabular-nums">{system?.cpu_logical ?? '-'}</div>
                  <div className="text-[9px] text-gray-400">threads</div>
                </div>
                <div className="bg-emerald-50/50 dark:bg-[#0f2428] rounded-lg p-2">
                  <div className="text-[10px] text-gray-400">Load 1m</div>
                  <div className="text-sm font-bold text-teal-600 dark:text-teal-400 tabular-nums">{current?.load_1m?.toFixed(1) ?? '-'}</div>
                  <div className="text-[9px] text-gray-400">秒级</div>
                </div>
                <div className="bg-emerald-50/50 dark:bg-[#0f2428] rounded-lg p-2">
                  <div className="text-[10px] text-gray-400">缓存</div>
                  <div className="text-sm font-bold text-teal-600 dark:text-teal-400 tabular-nums">{system?.cpu_cache_kb ?? '-'}</div>
                  <div className="text-[9px] text-gray-400">KB</div>
                </div>
                <div className="bg-emerald-50/50 dark:bg-[#0f2428] rounded-lg p-2">
                  <div className="text-[10px] text-gray-400">厂商</div>
                  <div className="text-sm font-bold text-teal-600 dark:text-teal-400 truncate">{system?.cpu_vendor ?? '-'}</div>
                  <div className="text-[9px] text-gray-400">vendor</div>
                </div>
              </div>
            </div>

            {system?.cpu_model && (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-400">
                <span className="w-3 h-3 rounded bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-[8px]">C</span>
                {system.cpu_model}
              </div>
            )}
          </div>

          {/* Section Title */}
          <div className="text-xs text-gray-400 dark:text-gray-500 pt-1">整体负载</div>

          {/* CPU Usage Trend Chart */}
          {usageData.length > 0 ? (
            <TimeSeriesChart
              title="总体占用趋势"
              subtitle={`当前 ${Math.round(usage)}%，先判断整体 CPU 压力是否持续抬升`}
              icon={<Activity size={14} />}
              data={usageData}
              lines={[{ dataKey: 'value', color: '#38bdf8', name: 'total' }]}
              yDomain={[0, 100]}
            />
          ) : (
            <ChartSkeleton />
          )}

          {/* Load Average Chart */}
          {loadData.length > 0 ? (
            <TimeSeriesChart
              title="Load Average"
              subtitle={`1m ${current?.load_1m?.toFixed(1) ?? '-'} · 5m ${current?.load_5m?.toFixed(1) ?? '-'} · 15m ${current?.load_15m?.toFixed(1) ?? '-'}`}
              icon={<Clock size={14} />}
              data={loadData}
              lines={[
                { dataKey: 'l1', color: '#38bdf8', name: 'load1' },
                { dataKey: 'l5', color: '#34d399', name: 'load5' },
                { dataKey: 'l15', color: '#fbbf24', name: 'load15' },
              ]}
              yDomain={[0, Math.max(4, ...(loadData.map(d => Math.max(d.l1, d.l5, d.l15))))]}
              yUnit=""
            />
          ) : (
            <ChartSkeleton />
          )}

          {/* Per-Core Usage */}
          {current?.per_core && current.per_core.length > 0 && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">占用拆解</h3>
              <div className="space-y-2">
                {current.per_core.map(core => (
                  <div key={core.core} className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-400 w-10 shrink-0 tabular-nums">核心 {core.core}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          core.percent >= 85 ? 'bg-rose-500' : core.percent >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${core.percent}%` }}
                      />
                    </div>
                    <span className={`text-[10px] tabular-nums w-8 text-right ${usageColor(core.percent)}`}>
                      {Math.round(core.percent)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </PullToRefresh>
    </div>
  )
}
