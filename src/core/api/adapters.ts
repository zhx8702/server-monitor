/**
 * API Response Adapters
 *
 * Go agent 返回 camelCase + 扁平结构，前端类型定义使用 snake_case + 嵌套结构。
 * 这里集中做格式转换，避免修改 Go agent 或组件代码。
 */
import type {
  SystemInfo,
  CpuData,
  MemoryData,
  NetworkData,
  DiskData,
  DockerData,
  ProcessData,
} from '../types/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── helpers ──

function unixSeconds(ts: string | number): number {
  if (typeof ts === 'number') return ts
  return Math.floor(new Date(ts).getTime() / 1000)
}

// ── /api/system ──

export function transformSystem(raw: any): SystemInfo {
  return {
    hostname: raw.hostname ?? '',
    os: raw.os ?? '',
    os_name: raw.osPrettyName ?? '',
    platform: raw.os ?? '',
    arch: raw.arch ?? '',
    kernel_version: raw.kernelVersion ?? '',
    virtualization: raw.virtualization ?? '',
    uptime_seconds: raw.uptimeSeconds ?? 0,
    boot_time: raw.bootTime ?? 0,
    cpu_model: raw.cpuModel ?? '',
    cpu_vendor: '',
    cpu_cores: raw.cpuCores ?? 0,
    cpu_logical: raw.cpuCores ?? 0,
    cpu_cache_kb: 0,
    cpu_mhz: 0,
    total_memory_bytes: raw.totalMemory ?? 0,
    total_swap_bytes: 0,
    total_disk_bytes: 0,
  }
}

// ── /api/cpu ──

export function transformCpu(raw: any): CpuData {
  return {
    current: {
      total_percent: raw.totalPercent ?? 0,
      user_percent: raw.userPercent ?? 0,
      system_percent: raw.systemPercent ?? 0,
      idle_percent: raw.idlePercent ?? 0,
      iowait_percent: raw.iowaitPercent ?? 0,
      per_core: (raw.perCore ?? []).map((c: any) => ({
        core: c.core,
        percent: c.totalPercent ?? 0,
      })),
      load_1m: raw.loadAvg?.load1 ?? 0,
      load_5m: raw.loadAvg?.load5 ?? 0,
      load_15m: raw.loadAvg?.load15 ?? 0,
      threads: raw.coreCount ?? 0,
      context_switches: 0,
    },
    history: raw.history
      ? {
          usage: raw.history.map((h: any) => ({
            ts: unixSeconds(h.timestamp),
            value: h.data?.totalPercent ?? 0,
          })),
          load: raw.history.map((h: any) => ({
            ts: unixSeconds(h.timestamp),
            l1: raw.loadAvg?.load1 ?? 0,
            l5: raw.loadAvg?.load5 ?? 0,
            l15: raw.loadAvg?.load15 ?? 0,
          })),
        }
      : undefined,
  }
}

// ── /api/memory ──

export function transformMemory(raw: any): MemoryData {
  return {
    current: {
      total_bytes: raw.totalBytes ?? 0,
      used_bytes: raw.usedBytes ?? 0,
      free_bytes: raw.freeBytes ?? 0,
      available_bytes: raw.availableBytes ?? 0,
      buffers_bytes: raw.buffersBytes ?? 0,
      cached_bytes: raw.cachedBytes ?? 0,
      usage_percent: raw.usagePercent ?? 0,
      swap_total_bytes: raw.swapTotalBytes ?? 0,
      swap_used_bytes: raw.swapUsedBytes ?? 0,
      swap_free_bytes: raw.swapFreeBytes ?? 0,
      swap_usage_percent: raw.swapUsagePercent ?? 0,
    },
    history: raw.history
      ? {
          usage: raw.history.map((h: any) => ({
            ts: unixSeconds(h.timestamp),
            value: h.data?.usagePercent ?? 0,
          })),
          swap: raw.history.map((h: any) => ({
            ts: unixSeconds(h.timestamp),
            value: h.data?.swapUsagePercent ?? 0,
          })),
        }
      : undefined,
  }
}

// ── /api/network ──

export function transformNetwork(raw: any): NetworkData {
  return {
    interfaces: (raw.interfaces ?? []).map((iface: any) => ({
      name: iface.name ?? '',
      rx_bytes_sec: iface.rxBytesSec ?? 0,
      tx_bytes_sec: iface.txBytesSec ?? 0,
      rx_packets_sec: iface.rxPacketsSec ?? 0,
      tx_packets_sec: iface.txPacketsSec ?? 0,
      rx_errors: 0,
      tx_errors: 0,
      ip_addresses: [],
      mac_address: '',
      mtu: 0,
      state: iface.state ?? 'unknown',
    })),
    history: raw.history
      ? transformNetworkHistory(raw.history)
      : undefined,
  }
}

function transformNetworkHistory(
  history: any[],
): Record<string, { rx: { ts: number; value: number }[]; tx: { ts: number; value: number }[] }> {
  const result: Record<string, { rx: { ts: number; value: number }[]; tx: { ts: number; value: number }[] }> = {}

  for (const entry of history) {
    const ts = unixSeconds(entry.timestamp)
    for (const iface of entry.data?.interfaces ?? []) {
      const name = iface.name
      if (!result[name]) result[name] = { rx: [], tx: [] }
      result[name].rx.push({ ts, value: iface.rxBytesSec ?? 0 })
      result[name].tx.push({ ts, value: iface.txBytesSec ?? 0 })
    }
  }

  return result
}

// ── /api/disk ──

export function transformDisk(raw: any): DiskData {
  return {
    filesystems: (raw.filesystems ?? []).map((fs: any) => ({
      device: fs.device ?? '',
      mount_point: fs.mountPoint ?? '',
      fs_type: fs.type ?? '',
      total_bytes: fs.totalBytes ?? 0,
      used_bytes: fs.usedBytes ?? 0,
      free_bytes: fs.freeBytes ?? 0,
      usage_percent: fs.usedPct ?? 0,
      inodes_total: 0,
      inodes_used: 0,
    })),
    io: (raw.io ?? []).map((io: any) => ({
      device: io.device ?? '',
      read_bytes_sec: io.readBytesSec ?? 0,
      write_bytes_sec: io.writeBytesSec ?? 0,
      read_iops: io.readIOPS ?? 0,
      write_iops: io.writeIOPS ?? 0,
      io_percent: io.ioUtilPercent ?? 0,
    })),
  }
}

// ── /api/docker ──

export function transformDocker(raw: any): DockerData {
  return {
    available: raw.available ?? false,
    version: raw.version ?? undefined,
    containers_running: raw.summary?.running ?? 0,
    containers_total: raw.summary?.total ?? 0,
    images_total: raw.imagesTotal ?? 0,
    containers: (raw.containers ?? []).map((c: any) => ({
      id: c.id ?? '',
      name: c.name ?? '',
      image: c.image ?? '',
      state: c.state ?? '',
      status: c.status ?? '',
      created: c.created ?? 0,
      ports: (c.ports ?? []).map((p: any) =>
        p.publicPort
          ? `${p.ip || '0.0.0.0'}:${p.publicPort}->${p.privatePort}/${p.type}`
          : `${p.privatePort}/${p.type}`,
      ),
      cpu_percent: c.cpuPercent ?? 0,
      memory_bytes: c.memUsage ?? 0,
      memory_limit_bytes: c.memLimit ?? 0,
      network_rx_bytes: c.netRx ?? 0,
      network_tx_bytes: c.netTx ?? 0,
    })),
    images: (raw.images ?? []).map((img: any) => ({
      id: img.id ?? '',
      tags: img.tags ?? [],
      size: img.size ?? 0,
      created: img.created ?? 0,
    })),
  }
}

// ── /api/processes ──

export function transformProcesses(raw: any): ProcessData {
  return {
    summary: {
      total: raw.summary?.total ?? 0,
      running: raw.summary?.running ?? 0,
      sleeping: raw.summary?.sleeping ?? 0,
      idle: raw.summary?.idle ?? 0,
      zombie: raw.summary?.zombie ?? 0,
      stopped: raw.summary?.stopped ?? 0,
    },
    processes: (raw.processes ?? []).map((p: any) => ({
      pid: p.pid ?? 0,
      name: p.name ?? '',
      state: p.state ?? '',
      command: p.command ?? '',
      user: p.user ?? '',
      cpu_percent: p.cpuPercent ?? 0,
      memory_percent: p.memPercent ?? 0,
      memory_rss_bytes: p.memRSS ?? 0,
      threads: p.threads ?? 0,
      started_at: 0,
      nice: 0,
    })),
  }
}

// ── Adapter registry ──

const adapterMap: Record<string, (raw: any) => any> = {
  '/api/system': transformSystem,
  '/api/cpu': transformCpu,
  '/api/memory': transformMemory,
  '/api/network': transformNetwork,
  '/api/disk': transformDisk,
  '/api/docker': transformDocker,
  '/api/processes': transformProcesses,
}

/**
 * 根据 API 路径自动选择适配器转换响应数据。
 * 如果没有匹配的适配器则原样返回。
 */
export function applyAdapter<T>(path: string, raw: unknown): T {
  const adapter = adapterMap[path]
  return adapter ? adapter(raw) : raw as T
}
