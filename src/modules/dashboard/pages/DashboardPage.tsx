import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { RingGauge } from '../../../core/components/RingGauge'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { EmptyState } from '../../../core/components/EmptyState'
import { GaugeCardSkeleton } from '../../../core/components/Skeleton'
import { formatBytes, formatSpeed, formatUptime, usageColor } from '../../../core/utils'
import type { SystemInfo, CpuData, MemoryData, NetworkData, DiskData, DockerData } from '../../../core/types/server'
import {
  Server, Clock, Cpu, MemoryStick, Network, HardDrive,
  Container, Layers, ChevronRight, MonitorCog,
} from 'lucide-react'

export function DashboardPage() {
  const { servers, activeServerId, groups, setActiveServer } = useServer()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: system, isLoading: sysLoading } = useAgentQuery<SystemInfo>('/api/system', undefined, { staleTime: 60_000 })
  const { data: cpu, isLoading: cpuLoading, error: cpuError, refetch: refetchCpu } = useAgentQuery<CpuData>('/api/cpu', undefined, { refetchInterval: 5_000 })
  const { data: memory } = useAgentQuery<MemoryData>('/api/memory', undefined, { refetchInterval: 5_000 })
  const { data: network } = useAgentQuery<NetworkData>('/api/network', undefined, { refetchInterval: 5_000 })
  const { data: disk } = useAgentQuery<DiskData>('/api/disk', undefined, { refetchInterval: 30_000 })
  const { data: docker } = useAgentQuery<DockerData>('/api/docker', undefined, { refetchInterval: 10_000 })

  const isLoading = sysLoading && cpuLoading

  const activeGroup = useMemo(() => {
    const server = servers.find(s => s.id === activeServerId)
    return server?.group
  }, [servers, activeServerId])

  const groupServers = useMemo(() => {
    if (!activeGroup) return servers
    return servers.filter(s => s.group === activeGroup)
  }, [servers, activeGroup])

  const cpuUsage = cpu?.current?.total_percent ?? 0
  const memUsage = memory?.current?.usage_percent ?? 0

  const primaryDisk = disk?.filesystems?.find(f => f.mount_point === '/') ?? disk?.filesystems?.[0]
  const diskUsage = primaryDisk?.usage_percent ?? 0

  const networkDevices = network?.interfaces?.filter(n => n.name !== 'lo') ?? []

  if (!activeServerId) {
    return (
      <EmptyState
        icon={<Server size={48} />}
        title="未添加服务器"
        description="请先添加一台服务器"
        action={
          <button onClick={() => navigate('/servers/add')} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white">
            添加服务器
          </button>
        }
      />
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PullToRefresh onRefresh={() => {
        queryClient.invalidateQueries({ queryKey: ['agent', activeServerId] })
      }}>
        <div className="p-4 pb-6 space-y-3">

          {/* Server Group Tabs */}
          {groups.length > 0 && (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
              {groups.map(g => {
                const isActive = g === activeGroup
                return (
                  <button
                    key={g}
                    onClick={() => {
                      const firstInGroup = servers.find(s => s.group === g)
                      if (firstInGroup) setActiveServer(firstInGroup.id)
                    }}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/25'
                        : 'bg-white dark:bg-dark-surface-2 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/[0.08]'
                    }`}
                  >
                    {g}
                  </button>
                )
              })}
            </div>
          )}

          {/* Quick Server Switch (if multiple in same group) */}
          {groupServers.length > 1 && (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
              {groupServers.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveServer(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all ${
                    s.id === activeServerId
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          {/* Section Label */}
          <div className="text-xs text-gray-400 dark:text-gray-500 pt-1 flex items-center gap-1.5">
            <MonitorCog size={12} />
            系统监控
          </div>

          {/* Error State */}
          {cpuError && !cpu && (
            <QueryErrorState message="连接服务器失败" onRetry={() => refetchCpu()} />
          )}

          {/* System Info Header */}
          <div
            className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 active:scale-[0.98] transition-transform cursor-pointer"
            onClick={() => navigate('/dashboard/system')}
          >
            {sysLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-5 w-40 bg-gray-100 dark:bg-white/[0.06] rounded" />
                <div className="h-3 w-24 bg-gray-100 dark:bg-white/[0.06] rounded" />
              </div>
            ) : system && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                    <MonitorCog size={20} className="text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{system.hostname}</h3>
                    <span className="text-xs text-gray-400">{system.os_name || `${system.os} · ${system.platform}`}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                  <span className="text-[10px] font-medium">在线</span>
                  <ChevronRight size={14} className="text-gray-300 dark:text-gray-600 ml-1" />
                </div>
              </div>
            )}
            {system && (
              <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-400 dark:text-gray-500">
                <span className="flex items-center gap-1"><Clock size={12} /> 运行 {formatUptime(system.uptime_seconds)}</span>
                <span className="flex items-center gap-1"><Cpu size={12} /> {system.cpu_logical} 核</span>
                <span className="flex items-center gap-1"><MemoryStick size={12} /> {formatBytes(system.total_memory_bytes)}</span>
              </div>
            )}
          </div>

          {/* Gauge Cards Grid */}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              <GaugeCardSkeleton />
              <GaugeCardSkeleton />
              <GaugeCardSkeleton />
              <GaugeCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 animate-fade-in">
              {/* CPU */}
              <div
                className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 active:scale-[0.97] transition-transform cursor-pointer"
                onClick={() => navigate('/dashboard/cpu')}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  <Cpu size={14} className="text-emerald-500" />
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">CPU</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{system?.cpu_logical ?? '-'}核 · {system?.cpu_mhz ? `${(system.cpu_mhz / 1000).toFixed(1)}GHz` : ''}</span>
                </div>
                <RingGauge value={cpuUsage} size={80} strokeWidth={7} />
                <div className="text-center mt-2 text-[10px] text-gray-400">
                  L {cpu?.current?.load_1m?.toFixed(1) ?? '-'}/{cpu?.current?.load_5m?.toFixed(1) ?? '-'}/{cpu?.current?.load_15m?.toFixed(1) ?? '-'}
                </div>
              </div>

              {/* Memory */}
              <div
                className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 active:scale-[0.97] transition-transform cursor-pointer"
                onClick={() => navigate('/dashboard/memory')}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  <MemoryStick size={14} className="text-emerald-500" />
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">内存</span>
                  <span className="text-[10px] text-gray-400 ml-auto">总量 {memory?.current ? formatBytes(memory.current.total_bytes) : '-'}</span>
                </div>
                <RingGauge value={memUsage} size={80} strokeWidth={7} />
                <div className="text-center mt-2 text-[10px] text-gray-400">
                  可用 {memory?.current ? formatBytes(memory.current.available_bytes) : '-'} · S{' '}
                  {memory?.current ? Math.round(memory.current.swap_usage_percent) : 0}%
                </div>
              </div>

              {/* Network */}
              <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Network size={14} className="text-emerald-500" />
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">网络</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{networkDevices[0]?.name ?? ''}</span>
                </div>
                {networkDevices.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-4">暂无数据</div>
                ) : (
                  <div className="space-y-2">
                    {networkDevices.slice(0, 2).map(net => (
                      <div key={net.name} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] tabular-nums">
                          <span className="text-[10px] text-gray-400">上</span>
                          <span className="text-rose-500 font-medium">{formatSpeed(net.tx_bytes_sec)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] tabular-nums">
                          <span className="text-[10px] text-gray-400">下</span>
                          <span className="text-rose-500 font-medium">{formatSpeed(net.rx_bytes_sec)}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 tabular-nums">
                          {net.ip_addresses?.[0] ?? net.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Disk - vertical bar like screenshot */}
              <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <HardDrive size={14} className="text-emerald-500" />
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">磁盘</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{primaryDisk?.mount_point ?? '/'}</span>
                </div>
                {primaryDisk && (
                  <div className="flex items-end gap-3">
                    {/* Vertical bar */}
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-sm font-bold tabular-nums ${usageColor(diskUsage)}`}>{Math.round(diskUsage)}%</span>
                      <div className="w-5 h-16 bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden flex flex-col-reverse">
                        <div
                          className={`w-full rounded-full transition-all duration-500 ${
                            diskUsage >= 85 ? 'bg-rose-500' : diskUsage >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ height: `${diskUsage}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex-1 space-y-1 text-[10px] text-gray-400 tabular-nums">
                      <div>读 {disk?.io?.[0] ? formatSpeed(disk.io[0].read_bytes_sec) : '0B'}</div>
                      <div>写 {disk?.io?.[0] ? formatSpeed(disk.io[0].write_bytes_sec) : '0B'}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Docker Summary */}
          {docker?.available && (
            <div
              className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up active:scale-[0.98] transition-transform cursor-pointer"
              onClick={() => navigate('/dashboard/docker')}
            >
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-3 flex items-center gap-1.5">
                <Container size={12} />
                Docker
                <ChevronRight size={12} className="ml-auto text-gray-300 dark:text-gray-600" />
              </div>

              <div className="flex items-center gap-3 mb-3 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  运行 {docker.containers_running}
                </span>
                <span className="flex items-center gap-1 text-gray-400">
                  <Container size={11} /> 容器 {docker.containers_total}
                </span>
                <span className="flex items-center gap-1 text-gray-400">
                  <Layers size={11} /> 镜像 {docker.images_total}
                </span>
              </div>

              {docker.version && (
                <div className="text-[10px] text-gray-400 mb-3">Docker {docker.version}</div>
              )}

              {docker.containers.length > 0 && (
                <div className="space-y-1">
                  {docker.containers.slice(0, 5).map(c => (
                    <div key={c.id} className="flex items-center justify-between py-2 px-2 -mx-1 rounded-xl">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          c.state === 'running'
                            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`} />
                        <div className="min-w-0">
                          <div className="text-sm text-gray-700 dark:text-gray-200 truncate">{c.name}</div>
                          <div className="text-[10px] text-gray-400 truncate">{c.image}</div>
                        </div>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        c.state === 'running'
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400'
                      }`}>
                        {c.state}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick Links */}
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/dashboard/processes')}
              className="flex-1 bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-3 flex items-center gap-2 active:scale-[0.97] transition-transform"
            >
              <MonitorCog size={16} className="text-emerald-500" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">进程概览</span>
              <span className="text-[10px] text-gray-400 ml-auto">查看全部</span>
              <ChevronRight size={14} className="text-gray-300 dark:text-gray-600" />
            </button>
          </div>

        </div>
      </PullToRefresh>
    </div>
  )
}
