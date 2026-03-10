import { lazy } from 'react'
import { Server, LayoutDashboard } from 'lucide-react'
import type { AppModule } from '../../core/types/module'

const ServerListPage = lazy(() => import('./pages/ServerListPage').then(m => ({ default: m.ServerListPage })))
const AddServerPage = lazy(() => import('./pages/AddServerPage').then(m => ({ default: m.AddServerPage })))

export const serversModule: AppModule = {
  name: 'servers',
  label: '服务器',
  icon: Server,
  path: '/servers',
  order: 20,
  routes: [
    { index: true, element: <ServerListPage /> },
    { path: 'add', element: <AddServerPage /> },
    { path: 'edit/:id', element: <AddServerPage /> },
  ],
  navItems: [
    { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
    { path: '/servers', label: '服务器', icon: Server },
  ],
}
