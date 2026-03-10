import { useQueryClient } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { RingGauge } from '../../../core/components/RingGauge'
import { TimeSeriesChart } from '../../../core/components/TimeSeriesChart'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { DetailSkeleton, ChartSkeleton } from '../../../core/components/Skeleton'
import { formatBytes, usageColor } from '../../../core/utils'
import type { MemoryData } from '../../../core/types/server'
import { Activity } from 'lucide-react'

export function MemoryDetailPage() {
  const { activeServerId } = useServer()
  const queryClient = useQueryClient()

  const { data: memory, isLoading, error, refetch } = useAgentQuery<MemoryData>(
    '/api/memory',
    { history: 'true' },
    { refetchInterval: 5_000 },
  )

  if (isLoading) return <DetailSkeleton />
  if (error && !memory) return <QueryErrorState message="加载内存数据失败" onRetry={() => refetch()} />

  const current = memory?.current
  const usage = current?.usage_percent ?? 0

  const usageData = memory?.history?.usage?.map(p => ({ ts: p.ts, value: p.value })) ?? []
  const swapData = memory?.history?.swap?.map(p => ({ ts: p.ts, value: p.value })) ?? []

  // Memory breakdown for stacked bar
  const totalBytes = current?.total_bytes ?? 1
  const usedPct = ((current?.used_bytes ?? 0) / totalBytes) * 100
  const buffersPct = ((current?.buffers_bytes ?? 0) / totalBytes) * 100
  const cachedPct = ((current?.cached_bytes ?? 0) / totalBytes) * 100
  const freePct = Math.max(0, 100 - usedPct - buffersPct - cachedPct)

  return (
    <div className="h-full flex flex-col">
      <PullToRefresh onRefresh={() => {
        queryClient.invalidateQueries({ queryKey: ['agent', activeServerId, '/api/memory'] })
      }}>
        <div className="p-4 pb-6 space-y-3">

          {/* Memory Overview Card */}
          {current && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-fade-in">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">内存概览</h3>

              <div className="flex items-center gap-6">
                <RingGauge value={usage} size={100} strokeWidth={9} />
                <div className="flex-1 space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-gray-400">已用</span>
                    <span className="text-gray-600 dark:text-gray-300 tabular-nums font-medium">{formatBytes(current.used_bytes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">可用</span>
                    <span className="text-gray-600 dark:text-gray-300 tabular-nums font-medium">{formatBytes(current.available_bytes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">总计</span>
                    <span className="text-gray-600 dark:text-gray-300 tabular-nums font-medium">{formatBytes(current.total_bytes)}</span>
                  </div>
                  {current.swap_total_bytes > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Swap</span>
                      <span className={`tabular-nums font-medium ${usageColor(current.swap_usage_percent)}`}>
                        {Math.round(current.swap_usage_percent)}% ({formatBytes(current.swap_used_bytes)})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Memory Usage Trend */}
          {usageData.length > 0 ? (
            <TimeSeriesChart
              title="内存使用趋势"
              subtitle={`当前 ${Math.round(usage)}%`}
              icon={<Activity size={14} />}
              data={usageData}
              lines={[{ dataKey: 'value', color: '#34d399', name: '使用率' }]}
              yDomain={[0, 100]}
            />
          ) : (
            <ChartSkeleton />
          )}

          {/* Swap Usage Trend */}
          {current && current.swap_total_bytes > 0 && (
            swapData.length > 0 ? (
              <TimeSeriesChart
                title="Swap 使用趋势"
                subtitle={`当前 ${Math.round(current.swap_usage_percent)}%`}
                data={swapData}
                lines={[{ dataKey: 'value', color: '#fbbf24', name: 'Swap' }]}
                yDomain={[0, 100]}
              />
            ) : (
              <ChartSkeleton />
            )
          )}

          {/* Memory Breakdown */}
          {current && (
            <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">内存分布</h3>

              {/* Stacked bar */}
              <div className="w-full h-3 flex rounded-full overflow-hidden mb-3">
                <div className="bg-teal-500 transition-all duration-500" style={{ width: `${usedPct}%` }} />
                <div className="bg-amber-400 transition-all duration-500" style={{ width: `${buffersPct}%` }} />
                <div className="bg-emerald-400 transition-all duration-500" style={{ width: `${cachedPct}%` }} />
                <div className="bg-gray-200 dark:bg-white/[0.06] transition-all duration-500" style={{ width: `${freePct}%` }} />
              </div>

              <div className="space-y-2">
                {[
                  { label: 'Used', value: current.used_bytes, color: 'bg-teal-500', pct: usedPct },
                  { label: 'Buffers', value: current.buffers_bytes, color: 'bg-amber-400', pct: buffersPct },
                  { label: 'Cached', value: current.cached_bytes, color: 'bg-emerald-400', pct: cachedPct },
                  { label: 'Free', value: current.free_bytes, color: 'bg-gray-200 dark:bg-white/[0.06]', pct: freePct },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-sm ${item.color}`} />
                      <span className="text-gray-500 dark:text-gray-400">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-700 dark:text-gray-200 tabular-nums font-medium">{formatBytes(item.value)}</span>
                      <span className="text-gray-400 tabular-nums w-10 text-right">{item.pct.toFixed(1)}%</span>
                    </div>
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
