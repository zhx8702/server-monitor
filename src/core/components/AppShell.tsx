import { Outlet, useLocation, useNavigate } from 'react-router'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Browser } from '@capacitor/browser'
import { useServer } from '../contexts/ServerContext'
import { useAppUpdate } from '../hooks/useAppUpdate'
import { BottomNav } from './BottomNav'
import { ToastContainer } from './Toast'
import { modules } from '../../registry'
import { Home, ArrowLeft, ChevronDown, Sun, Moon, Download, X } from 'lucide-react'

export function AppShell() {
  const { servers, activeServerId, isLoading } = useServer()
  const location = useLocation()
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [dismissedUpdate, setDismissedUpdate] = useState(false)
  const { data: appUpdate } = useAppUpdate()

  const toggleTheme = useCallback(() => {
    const html = document.documentElement
    html.classList.add('theme-transitioning')
    const next = !isDark
    html.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#0c0f14' : '#ffffff')
    setIsDark(next)
    setTimeout(() => html.classList.remove('theme-transitioning'), 400)
  }, [isDark])

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    const inner = mainRef.current?.querySelector('.overflow-y-auto, [class*="overflow-y"]')
    if (inner) (inner as HTMLElement).scrollTo(0, 0)
  }, [location.pathname])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-dark-surface">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const currentModule = modules.find(m => location.pathname.startsWith(m.path))
  const isHome = location.pathname === '/'
  const title = currentModule?.label ?? 'ServerMonitor'

  const pathParts = location.pathname.split('/').filter(Boolean)
  const isDetailPage = currentModule && pathParts.length > 2

  const activeServer = servers.find(s => s.id === activeServerId)

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-dark-surface">
      <ToastContainer />

      {/* Header */}
      <header className="bg-white/80 dark:bg-dark-surface-2/80 glass border-b border-gray-200/60 dark:border-white/[0.06] safe-top">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="flex items-center gap-2.5">
            {currentModule && !isDetailPage && (
              <button
                onClick={() => navigate('/')}
                aria-label="返回首页"
                className="text-gray-400 dark:text-gray-400 active:text-gray-600 -ml-1 p-2.5"
              >
                <Home size={18} />
              </button>
            )}
            {isDetailPage && (
              <button
                onClick={() => navigate(-1)}
                aria-label="返回上一页"
                className="text-gray-400 dark:text-gray-400 active:text-gray-600 -ml-1 p-2.5"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h1 className="text-base font-semibold text-gray-900 dark:text-white">{isHome ? 'ServerMonitor' : title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {activeServer && (
              <button
                onClick={() => navigate('/servers')}
                className="flex items-center gap-1.5 active:opacity-70 transition-opacity"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                <span className="text-xs text-gray-500 dark:text-gray-400">{activeServer.name}</span>
                <ChevronDown size={12} className="text-gray-400" />
              </button>
            )}
            <button
              onClick={toggleTheme}
              aria-label="切换主题"
              className="p-2 rounded-xl text-gray-400 dark:text-gray-400 active:bg-gray-100 dark:active:bg-white/[0.06] transition-colors"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* App Update Banner */}
      {appUpdate?.updateAvailable && !dismissedUpdate && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200/60 dark:border-amber-500/20">
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <Download size={14} />
            <span>新版本 {appUpdate.latestVersion} 可用</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => Browser.open({ url: appUpdate.downloadUrl || appUpdate.releaseUrl })}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500 text-white active:scale-95 transition-transform"
            >
              下载更新
            </button>
            <button
              onClick={() => setDismissedUpdate(true)}
              className="p-1 rounded-lg text-amber-400 active:bg-amber-100 dark:active:bg-amber-500/20 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main ref={mainRef} className="flex-1 overflow-hidden">
        <div key={location.pathname} className="h-full animate-page-enter">
          <Outlet />
        </div>
      </main>

      <BottomNav isHome={isHome} currentModule={currentModule} />
    </div>
  )
}
