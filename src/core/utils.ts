export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const segs: string[] = []
  if (days > 0) segs.push(`${days} 天`)
  if (hours > 0) segs.push(`${hours} 小时`)
  if (minutes > 0) segs.push(`${minutes} 分钟`)
  return segs.join(' ') || '刚刚启动'
}

export function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTimeShort(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function usageColor(pct: number): string {
  if (pct >= 85) return 'text-rose-500'
  if (pct >= 60) return 'text-amber-500'
  return 'text-emerald-500'
}

export function barColor(pct: number): string {
  if (pct >= 85) return 'bg-rose-500'
  if (pct >= 60) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function ringColor(pct: number): string {
  if (pct >= 85) return 'stroke-rose-500'
  if (pct >= 60) return 'stroke-amber-500'
  return 'stroke-emerald-500'
}

export function generateId(): string {
  return crypto.randomUUID()
}
