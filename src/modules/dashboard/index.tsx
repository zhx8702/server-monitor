import { lazy } from 'react'
import { LayoutDashboard, Bot, Server } from 'lucide-react'
import type { AppModule } from '../../core/types/module'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const SystemDetailPage = lazy(() => import('../system/pages/SystemDetailPage').then(m => ({ default: m.SystemDetailPage })))
const CpuDetailPage = lazy(() => import('../cpu/pages/CpuDetailPage').then(m => ({ default: m.CpuDetailPage })))
const MemoryDetailPage = lazy(() => import('../memory/pages/MemoryDetailPage').then(m => ({ default: m.MemoryDetailPage })))
const ProcessListPage = lazy(() => import('../processes/pages/ProcessListPage').then(m => ({ default: m.ProcessListPage })))
const DockerDetailPage = lazy(() => import('../docker/pages/DockerDetailPage').then(m => ({ default: m.DockerDetailPage })))
const AlertSettingsPage = lazy(() => import('../system/pages/AlertSettingsPage').then(m => ({ default: m.AlertSettingsPage })))

export const dashboardModule: AppModule = {
  name: 'dashboard',
  label: '仪表盘',
  icon: LayoutDashboard,
  path: '/dashboard',
  order: 10,
  routes: [
    { index: true, element: <DashboardPage /> },
    { path: 'system', element: <SystemDetailPage /> },
    { path: 'cpu', element: <CpuDetailPage /> },
    { path: 'memory', element: <MemoryDetailPage /> },
    { path: 'processes', element: <ProcessListPage /> },
    { path: 'docker', element: <DockerDetailPage /> },
    { path: 'alerts', element: <AlertSettingsPage /> },
  ],
  navItems: [
    { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
    { path: '/ai', label: 'AI 助手', icon: Bot },
    { path: '/servers', label: '服务器', icon: Server },
  ],
}
