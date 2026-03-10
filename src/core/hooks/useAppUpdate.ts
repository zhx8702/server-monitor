import { useQuery } from '@tanstack/react-query'

const GITHUB_REPO = 'zhx8702/server-monitor'

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

async function checkAppUpdate(): Promise<AppUpdateInfo> {
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`)

  const release: GitHubRelease = await resp.json()
  const latest = release.tag_name
  const updateAvailable = isNewer(__APP_VERSION__, latest)

  const apkAsset = release.assets.find(a => a.name.endsWith('.apk'))

  return {
    latestVersion: latest,
    updateAvailable,
    downloadUrl: apkAsset?.browser_download_url ?? null,
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
