import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { ServerProvider } from './core/contexts/ServerContext'
import { AIChatProvider } from './modules/ai/contexts/AIChatContext'
import { ToastProvider } from './core/contexts/ToastContext'
import App from './App'
import './index.css'

// Capacitor 环境下 SW 无意义（资源已打包在 APK），且会导致覆盖安装后页面报错
// 原因：旧 SW precache 了带 hash 的旧文件名，新 APK 的文件名变了，旧 SW 无法匹配
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister())
  })
  caches.keys().then(keys => {
    keys.forEach(k => caches.delete(k))
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServerProvider>
        <AIChatProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AIChatProvider>
      </ServerProvider>
    </QueryClientProvider>
  </StrictMode>,
)
