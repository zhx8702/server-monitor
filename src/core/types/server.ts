export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  token: string
  protocol: 'http' | 'https'
  group?: string
}

export interface SystemInfo {
  hostname: string
  os: string
  os_name: string
  platform: string
  arch: string
  kernel_version: string
  virtualization: string
  uptime_seconds: number
  boot_time: number
  cpu_model: string
  cpu_vendor: string
  cpu_cores: number
  cpu_logical: number
  cpu_cache_kb: number
  cpu_mhz: number
  total_memory_bytes: number
  total_swap_bytes: number
  total_disk_bytes: number
}

export interface CpuCurrent {
  total_percent: number
  user_percent: number
  system_percent: number
  idle_percent: number
  iowait_percent: number
  per_core: { core: number; percent: number }[]
  load_1m: number
  load_5m: number
  load_15m: number
  threads: number
  context_switches: number
}

export interface TimePoint {
  ts: number
  value: number
}

export interface LoadPoint {
  ts: number
  l1: number
  l5: number
  l15: number
}

export interface CpuData {
  current: CpuCurrent
  history?: {
    usage: TimePoint[]
    load: LoadPoint[]
  }
}

export interface MemoryCurrent {
  total_bytes: number
  used_bytes: number
  free_bytes: number
  available_bytes: number
  buffers_bytes: number
  cached_bytes: number
  usage_percent: number
  swap_total_bytes: number
  swap_used_bytes: number
  swap_free_bytes: number
  swap_usage_percent: number
}

export interface MemoryData {
  current: MemoryCurrent
  history?: {
    usage: TimePoint[]
    swap: TimePoint[]
  }
}

export interface NetworkInterface {
  name: string
  rx_bytes_sec: number
  tx_bytes_sec: number
  rx_packets_sec: number
  tx_packets_sec: number
  rx_errors: number
  tx_errors: number
  ip_addresses: string[]
  mac_address: string
  mtu: number
  state: string
}

export interface NetworkData {
  interfaces: NetworkInterface[]
  history?: Record<string, {
    rx: TimePoint[]
    tx: TimePoint[]
  }>
}

export interface DiskFilesystem {
  device: string
  mount_point: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_percent: number
  inodes_total: number
  inodes_used: number
}

export interface DiskIO {
  device: string
  read_bytes_sec: number
  write_bytes_sec: number
  read_iops: number
  write_iops: number
  io_percent: number
}

export interface DiskData {
  filesystems: DiskFilesystem[]
  io: DiskIO[]
}

export interface ProcessSummary {
  total: number
  running: number
  sleeping: number
  idle: number
  zombie: number
  stopped: number
}

export interface ProcessInfo {
  pid: number
  name: string
  state: string
  command: string
  user: string
  cpu_percent: number
  memory_percent: number
  memory_rss_bytes: number
  threads: number
  started_at: number
  nice: number
}

export interface ProcessData {
  summary: ProcessSummary
  processes: ProcessInfo[]
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  state: string
  status: string
  created: number
  ports: string[]
  cpu_percent: number
  memory_bytes: number
  memory_limit_bytes: number
  network_rx_bytes: number
  network_tx_bytes: number
}

export interface DockerImage {
  id: string
  tags: string[]
  size: number
  created: number
}

export interface DockerData {
  available: boolean
  version?: string
  containers_running: number
  containers_total: number
  images_total: number
  containers: DockerContainer[]
  images: DockerImage[]
}

// --- Agent Info ---

export interface AgentInfo {
  version: string
  commit: string
  buildTime: string
  uptime: number
  modules: { name: string; type: string }[]
}

// --- Update Types ---

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl?: string
  releaseNotes?: string
  publishedAt?: string
  assetSize?: number
}

// --- Alert Types ---

export interface AlertRule {
  id: string
  name: string
  metric: string        // "memory_usage","disk_usage","load_1","load_5","load_15"
  operator: string      // ">","<",">=","<="
  threshold: number
  duration: number      // seconds
  severity: string      // "critical","warning","info"
  enabled: boolean
  mountPoint?: string   // only for disk_usage
}

export interface NotifyChannel {
  id: string
  name: string
  type: string          // "webhook"
  url: string
  enabled: boolean
}

export interface AlertEvent {
  ruleId: string
  ruleName: string
  metric: string
  value: number
  threshold: number
  severity: string
  status: string        // "firing","resolved"
  firedAt: string
  resolvedAt?: string
}

export interface AlertsOverview {
  activeCount: number
  ruleCount: number
  channelCount: number
  recentEvents: AlertEvent[]
}
