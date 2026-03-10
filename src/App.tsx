import { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { App as CapApp } from '@capacitor/app'
import { AppShell } from './core/components/AppShell'
import { ErrorBoundary } from './core/components/ErrorBoundary'
import { modules } from './registry'

const pageLoader = (
  <div className="h-full flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
  </div>
)

function App() {
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
    }

    const listener = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back()
      } else {
        CapApp.minimizeApp()
      }
    })
    return () => { listener.then(l => l.remove()) }
  }, [])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            {modules.map(mod => (
              <Route key={mod.name} path={mod.path}>
                {mod.routes.map((r, i) =>
                  r.index
                    ? <Route key={i} index element={<ErrorBoundary><Suspense fallback={pageLoader}>{r.element}</Suspense></ErrorBoundary>} />
                    : <Route key={i} path={r.path} element={<ErrorBoundary><Suspense fallback={pageLoader}>{r.element}</Suspense></ErrorBoundary>} />
                )}
              </Route>
            ))}
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
