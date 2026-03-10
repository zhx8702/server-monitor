import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { Skeleton } from '../../../core/components/Skeleton'
import type { ProcessData } from '../../../core/types/server'
import { Search, ListTree } from 'lucide-react'

type SortField = 'pid' | 'cpu' | 'memory'
type StateFilter = 'all' | 'running' | 'sleeping' | 'idle' | 'zombie'

const stateLabels: Record<string, string> = {
  R: '运行',
  S: '睡眠',
  D: '磁盘',
  I: '空闲',
  Z: '僵尸',
  T: '停止',
  t: '停止',
}

// 状态过滤器 → 对应的单字母状态码
const stateFilterCodes: Record<StateFilter, string[]> = {
  all: [],
  running: ['R'],
  sleeping: ['S', 'D'],
  idle: ['I'],
  zombie: ['Z'],
}

export function ProcessListPage() {
  const { activeServerId } = useServer()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('cpu')
  const [filterState, setFilterState] = useState<StateFilter>('all')

  const { data, isLoading, error, refetch } = useAgentQuery<ProcessData>(
    '/api/processes',
    { sort: sortBy, order: 'desc', limit: '100' },
    { refetchInterval: 3_000 },
  )

  const filtered = useMemo(() => {
    if (!data) return []
    let list = data.processes

    // 按状态过滤
    if (filterState !== 'all') {
      const codes = stateFilterCodes[filterState]
      list = list.filter(p => codes.includes(p.state))
    }

    // 按搜索词过滤
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.command.toLowerCase().includes(q) ||
        String(p.pid).includes(q)
      )
    }

    return list
  }, [data, search, filterState])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 p-4 pb-0 space-y-3">

        {/* Title */}
        <div className="flex items-center gap-2">
          <ListTree size={16} className="text-emerald-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">进程列表</h3>
          {data && <span className="text-[10px] text-gray-400">按 {sortBy === 'pid' ? 'PID' : sortBy.toUpperCase()} {sortBy === 'pid' ? '升序' : '降序'}</span>}
        </div>

        {/* Summary — 点击可过滤 */}
        {data && (
          <div className="flex gap-2">
            {([
              { key: 'running' as StateFilter, label: '运行', value: data.summary.running, activeColor: 'ring-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500', inactiveColor: 'text-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/5' },
              { key: 'sleeping' as StateFilter, label: '睡眠', value: data.summary.sleeping, activeColor: 'ring-gray-400 bg-gray-100 dark:bg-white/[0.08] text-gray-500', inactiveColor: 'text-gray-500 bg-gray-100 dark:bg-white/[0.06]' },
              { key: 'idle' as StateFilter, label: '空闲', value: data.summary.idle, activeColor: 'ring-gray-400 bg-gray-100 dark:bg-white/[0.08] text-gray-500', inactiveColor: 'text-gray-500 bg-gray-100 dark:bg-white/[0.06]' },
              { key: 'zombie' as StateFilter, label: '僵尸', value: data.summary.zombie, activeColor: 'ring-rose-400 bg-rose-50 dark:bg-rose-500/10 text-rose-500', inactiveColor: 'text-rose-500 bg-rose-50/50 dark:bg-rose-500/5' },
            ]).map(item => {
              const isActive = filterState === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setFilterState(isActive ? 'all' : item.key)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-center transition-all ${
                    isActive ? `ring-2 ${item.activeColor}` : item.inactiveColor
                  }`}
                >
                  <div className="text-[10px]">{item.label}</div>
                  <div className="text-sm font-bold tabular-nums">{item.value}</div>
                </button>
              )
            })}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索 pid、进程名、命令"
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-dark-surface-2 rounded-xl text-sm placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-white/[0.08] outline-none focus:ring-2 focus:ring-emerald-400/30 transition-shadow"
          />
        </div>

        {/* Sort Tabs */}
        <div className="flex gap-2">
          {([
            { key: 'pid' as SortField, label: 'PID' },
            { key: 'cpu' as SortField, label: 'CPU' },
            { key: 'memory' as SortField, label: '内存' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setSortBy(tab.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                sortBy === tab.key
                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/25'
                  : 'bg-white dark:bg-dark-surface-2 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/[0.08]'
              }`}
            >
              {tab.label} {sortBy === tab.key ? '↑' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Process List */}
      <div className="flex-1 overflow-y-auto">
        <PullToRefresh onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['agent', activeServerId, '/api/processes'] })
        }}>
          <div className="px-4 pb-6 space-y-2 pt-3">
            {isLoading && (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-xl p-3 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            )}

            {error && !data && (
              <QueryErrorState message="加载进程列表失败" onRetry={() => refetch()} />
            )}

            {filtered.map(proc => (
              <div
                key={proc.pid}
                className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-xl p-3"
              >
                {/* Name + CPU/MEM */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{proc.name}</span>
                  <div className="flex items-center gap-2 shrink-0 text-[10px] tabular-nums">
                    <span className="text-emerald-500">CPU {proc.cpu_percent.toFixed(1)}%</span>
                    <span className="text-rose-500">MEM {proc.memory_percent.toFixed(1)}%</span>
                  </div>
                </div>

                {/* PID + State */}
                <div className="text-[10px] text-gray-400 mb-1">
                  PID {proc.pid} · {proc.state}
                </div>

                {/* Command */}
                {proc.command && (
                  <div className="text-[10px] text-gray-400 font-mono truncate mb-2">{proc.command}</div>
                )}

                {/* Bottom stats boxes */}
                <div className="flex gap-2">
                  <div className="flex-1 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-2 py-1 text-center">
                    <span className="text-[10px] text-gray-400">CPU</span>
                    <div className="text-[11px] font-medium text-emerald-500 tabular-nums">{proc.cpu_percent.toFixed(1)}%</div>
                  </div>
                  <div className="flex-1 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-2 py-1 text-center">
                    <span className="text-[10px] text-gray-400">内存</span>
                    <div className="text-[11px] font-medium text-rose-500 tabular-nums">{proc.memory_percent.toFixed(1)}%</div>
                  </div>
                  <div className="flex-1 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-2 py-1 text-center">
                    <span className="text-[10px] text-gray-400">状态</span>
                    <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{stateLabels[proc.state] ?? proc.state}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PullToRefresh>
      </div>
    </div>
  )
}
