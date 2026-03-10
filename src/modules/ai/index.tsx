import { lazy } from 'react'
import { Bot, LayoutDashboard, Server, TerminalSquare } from 'lucide-react'
import type { AppModule } from '../../core/types/module'

const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })))
const TerminalPage = lazy(() => import('./pages/TerminalPage').then(m => ({ default: m.TerminalPage })))

export const aiModule: AppModule = {
  name: 'ai',
  label: 'AI 助手',
  icon: Bot,
  path: '/ai',
  order: 15,
  routes: [
    { index: true, element: <ChatPage /> },
    { path: 'terminal', element: <TerminalPage /> },
  ],
  navItems: [
    { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
    { path: '/ai', label: 'AI 助手', icon: Bot },
    { path: '/ai/terminal', label: '终端', icon: TerminalSquare },
    { path: '/servers', label: '服务器', icon: Server },
  ],
}
