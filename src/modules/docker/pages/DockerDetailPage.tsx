import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { Skeleton } from '../../../core/components/Skeleton'
import { formatBytes } from '../../../core/utils'
import type { DockerData } from '../../../core/types/server'
import { Container, Layers, Search, Play, Square, RotateCw, Loader2 } from 'lucide-react'

type Tab = 'containers' | 'images'
type StateFilter = 'all' | 'running' | 'stopped' | 'paused'

export function DockerDetailPage() {
  const { activeServerId, getClient } = useServer()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('containers')
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<StateFilter>('all')
  const [actingId, setActingId] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useAgentQuery<DockerData>(
    '/api/docker',
    undefined,
    { refetchInterval: 10_000 },
  )

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const client = getClient()
      if (!client) throw new Error('No active server')
      return client.post<{ success: boolean }>('/api/docker/action', { id, action })
    },
    onMutate: ({ id }) => setActingId(id),
    onSettled: () => {
      setActingId(null)
      queryClient.invalidateQueries({ queryKey: ['agent', activeServerId, '/api/docker'] })
    },
  })

  const stoppedCount = useMemo(() => {
    if (!data) return 0
    return data.containers.filter(c => c.state !== 'running' && c.state !== 'paused').length
  }, [data])

  const pausedCount = useMemo(() => {
    if (!data) return 0
    return data.containers.filter(c => c.state === 'paused').length
  }, [data])

  const filteredContainers = useMemo(() => {
    if (!data) return []
    let list = data.containers

    if (filterState === 'running') list = list.filter(c => c.state === 'running')
    else if (filterState === 'stopped') list = list.filter(c => c.state !== 'running' && c.state !== 'paused')
    else if (filterState === 'paused') list = list.filter(c => c.state === 'paused')

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q)
      )
    }

    return list
  }, [data, search, filterState])

  const filteredImages = useMemo(() => {
    if (!data) return []
    if (!search.trim()) return data.images
    const q = search.toLowerCase()
    return data.images.filter(img =>
      img.tags.some(t => t.toLowerCase().includes(q)) ||
      img.id.toLowerCase().includes(q)
    )
  }, [data, search])

  function formatImageAge(created: number) {
    const seconds = Math.floor(Date.now() / 1000) - created
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} 天前`
    return `${Math.floor(seconds / 2592000)} 个月前`
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 p-4 pb-0 space-y-3">
        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/[0.06] rounded-xl p-1">
          <button
            onClick={() => setTab('containers')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === 'containers'
                ? 'bg-white dark:bg-dark-surface-2 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Container size={13} />
            容器 {data ? data.containers_total : ''}
          </button>
          <button
            onClick={() => setTab('images')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === 'images'
                ? 'bg-white dark:bg-dark-surface-2 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Layers size={13} />
            镜像 {data ? data.images_total : ''}
          </button>
        </div>

        {/* Summary chips (containers tab only) */}
        {tab === 'containers' && data && (
          <div className="flex gap-2">
            {([
              { key: 'running' as StateFilter, label: '运行', value: data.containers_running, activeColor: 'ring-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500', inactiveColor: 'text-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/5' },
              { key: 'stopped' as StateFilter, label: '停止', value: stoppedCount, activeColor: 'ring-gray-400 bg-gray-100 dark:bg-white/[0.08] text-gray-500', inactiveColor: 'text-gray-500 bg-gray-100 dark:bg-white/[0.06]' },
              { key: 'paused' as StateFilter, label: '暂停', value: pausedCount, activeColor: 'ring-amber-400 bg-amber-50 dark:bg-amber-500/10 text-amber-500', inactiveColor: 'text-amber-500 bg-amber-50/50 dark:bg-amber-500/5' },
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
            placeholder={tab === 'containers' ? '搜索容器名、镜像名' : '搜索镜像名、ID'}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-dark-surface-2 rounded-xl text-sm placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-white/[0.08] outline-none focus:ring-2 focus:ring-emerald-400/30 transition-shadow"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <PullToRefresh onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['agent', activeServerId, '/api/docker'] })
        }}>
          <div className="px-4 pb-6 space-y-2 pt-3">
            {isLoading && (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-xl p-3 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            )}

            {error && !data && (
              <QueryErrorState message="加载 Docker 信息失败" onRetry={() => refetch()} />
            )}

            {data && !data.available && (
              <div className="text-center py-12">
                <Container size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-400">Docker 不可用</p>
              </div>
            )}

            {/* Containers list */}
            {tab === 'containers' && filteredContainers.map(c => {
              const isRunning = c.state === 'running'
              const isActing = actingId === c.id
              const memPct = c.memory_limit_bytes > 0
                ? (c.memory_bytes / c.memory_limit_bytes * 100).toFixed(1)
                : '0'

              return (
                <div
                  key={c.id}
                  className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-xl p-3"
                >
                  {/* Name + State badge */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isRunning
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]'
                          : c.state === 'paused'
                            ? 'bg-amber-400'
                            : 'bg-gray-300 dark:bg-gray-600'
                      }`} />
                      <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{c.name}</span>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                      isRunning
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : c.state === 'paused'
                          ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400'
                    }`}>
                      {c.state}
                    </span>
                  </div>

                  {/* Image + Status */}
                  <div className="text-[10px] text-gray-400 mb-2 truncate">
                    {c.image} · {c.status}
                  </div>

                  {/* Resource stats (running only) */}
                  {isRunning && (
                    <div className="flex gap-2 mb-2">
                      <div className="flex-1 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-2 py-1 text-center">
                        <span className="text-[10px] text-gray-400">CPU</span>
                        <div className="text-[11px] font-medium text-emerald-500 tabular-nums">{c.cpu_percent.toFixed(1)}%</div>
                      </div>
                      <div className="flex-1 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-2 py-1 text-center">
                        <span className="text-[10px] text-gray-400">MEM</span>
                        <div className="text-[11px] font-medium text-rose-500 tabular-nums">
                          {formatBytes(c.memory_bytes)}{c.memory_limit_bytes > 0 ? ` / ${formatBytes(c.memory_limit_bytes)}` : ''}
                        </div>
                      </div>
                      <div className="flex-1 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-2 py-1 text-center">
                        <span className="text-[10px] text-gray-400">MEM%</span>
                        <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300 tabular-nums">{memPct}%</div>
                      </div>
                    </div>
                  )}

                  {/* Ports */}
                  {c.ports.length > 0 && (
                    <div className="text-[10px] text-gray-400 mb-2 font-mono truncate">
                      {c.ports.join(', ')}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {isRunning ? (
                      <>
                        <button
                          disabled={isActing}
                          onClick={() => actionMutation.mutate({ id: c.id, action: 'stop' })}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 active:scale-[0.97] transition-all disabled:opacity-50"
                        >
                          <Loader2 size={12} className={`animate-spin ${isActing ? '' : 'hidden'}`} />
                          <Square size={12} className={isActing ? 'hidden' : ''} />
                          停止
                        </button>
                        <button
                          disabled={isActing}
                          onClick={() => actionMutation.mutate({ id: c.id, action: 'restart' })}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:scale-[0.97] transition-all disabled:opacity-50"
                        >
                          <Loader2 size={12} className={`animate-spin ${isActing ? '' : 'hidden'}`} />
                          <RotateCw size={12} className={isActing ? 'hidden' : ''} />
                          重启
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={isActing}
                        onClick={() => actionMutation.mutate({ id: c.id, action: 'start' })}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:scale-[0.97] transition-all disabled:opacity-50"
                      >
                        <Loader2 size={12} className={`animate-spin ${isActing ? '' : 'hidden'}`} />
                        <Play size={12} className={isActing ? 'hidden' : ''} />
                        启动
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Images list */}
            {tab === 'images' && filteredImages.map(img => (
              <div
                key={img.id}
                className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-xl p-3"
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate mb-1">
                  {img.tags.length > 0 ? img.tags[0] : '<none>'}
                </div>
                {img.tags.length > 1 && (
                  <div className="text-[10px] text-gray-400 mb-1 truncate">
                    {img.tags.slice(1).join(', ')}
                  </div>
                )}
                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  <span>{formatBytes(img.size)}</span>
                  <span>{formatImageAge(img.created)}</span>
                  <span className="font-mono truncate">{img.id.replace('sha256:', '').slice(0, 12)}</span>
                </div>
              </div>
            ))}

            {/* Empty state for images */}
            {tab === 'images' && data?.available && filteredImages.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Layers size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-400">{search.trim() ? '未找到匹配的镜像' : '暂无镜像'}</p>
              </div>
            )}
          </div>
        </PullToRefresh>
      </div>
    </div>
  )
}
