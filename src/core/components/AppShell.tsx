import { Outlet, useLocation, useNavigate } from 'react-router'
import { useEffect, useRef } from 'react'
import { useServer } from '../contexts/ServerContext'
import { BottomNav } from './BottomNav'
import { ToastContainer } from './Toast'
import { modules } from '../../registry'
import { Home, ArrowLeft, ChevronDown } from 'lucide-react'

export function AppShell() {
  const { servers, activeServerId, isLoading } = useServer()
  const location = useLocation()
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)

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
        </div>
      </header>

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
