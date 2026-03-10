import { useQuery } from '@tanstack/react-query'

const GITHUB_REPO = 'zhx8702/server-monitor'
const GITHUB_PROXIES = ['https://ghproxy.net', 'https://mirror.ghproxy.com']

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  published_at: string
  html_url: string
  assets: GitHubAsset[]
}

export interface AppUpdateInfo {
  latestVersion: string
  updateAvailable: boolean
  downloadUrl: string | null
  releaseUrl: string
  publishedAt: string
  assetSize: number
}

/** Fetch a GitHub URL with automatic proxy fallback for users who cannot access github.com. */
async function fetchWithGitHubFallback(url: string): Promise<{ resp: Response; proxy: string }> {
  // Try direct first
  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok) return { resp, proxy: '' }
  } catch {
    // direct failed, try proxies
  }

  for (const proxy of GITHUB_PROXIES) {
    try {
      const resp = await fetch(`${proxy}/${url}`, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      })
      if (resp.ok) return { resp, proxy }
    } catch {
      continue
    }
  }

  throw new Error('GitHub API unreachable (tried direct and proxies)')
}

async function checkAppUpdate(): Promise<AppUpdateInfo> {
  const { resp, proxy } = await fetchWithGitHubFallback(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
  )

  const release: GitHubRelease = await resp.json()
  const latest = release.tag_name
  const updateAvailable = isNewer(__APP_VERSION__, latest)

  const apkAsset = release.assets.find(a => a.name.endsWith('.apk'))
  let downloadUrl = apkAsset?.browser_download_url ?? null
  // If we used a proxy to reach the API, also proxy the download URL
  if (downloadUrl && proxy) {
    downloadUrl = `${proxy}/${downloadUrl}`
  }

  return {
    latestVersion: latest,
    updateAvailable,
    downloadUrl,
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    assetSize: apkAsset?.size ?? 0,
  }
}

/** Compare semver: returns true if latest is newer than current */
function isNewer(current: string, latest: string): boolean {
  const c = current.replace(/^v/, '')
  const l = latest.replace(/^v/, '')
  if (!c || c === 'dev' || c === 'unknown') return l !== 'dev' && l !== 'unknown' && !!l
  if (!l || l === 'dev' || l === 'unknown') return false
  return l !== c && compareSemver(c, l) < 0
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

export function useAppUpdate(enabled = true) {
  return useQuery({
    queryKey: ['app-update'],
    queryFn: checkAppUpdate,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    enabled,
  })
}

/** Re-export for use in ServerListPage to compare agent versions */
export { isNewer }
