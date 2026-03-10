import { lazy } from 'react'
import { Bot, LayoutDashboard, Server } from 'lucide-react'
import type { AppModule } from '../../core/types/module'

const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })))

export const aiModule: AppModule = {
  name: 'ai',
  label: 'AI 助手',
  icon: Bot,
  path: '/ai',
  order: 15,
  routes: [
    { index: true, element: <ChatPage /> },
  ],
  navItems: [
    { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
    { path: '/ai', label: 'AI 助手', icon: Bot },
    { path: '/servers', label: '服务器', icon: Server },
  ],
}
