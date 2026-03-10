import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ServerProvider } from './core/contexts/ServerContext'
import { ToastProvider } from './core/contexts/ToastContext'
import App from './App'
import './index.css'

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
        <ToastProvider>
          <App />
        </ToastProvider>
      </ServerProvider>
    </QueryClientProvider>
  </StrictMode>,
)
