import { NavLink } from 'react-router'
import { LayoutDashboard, Bot, Server } from 'lucide-react'
import type { AppModule } from '../types/module'

interface BottomNavProps {
  isHome: boolean
  currentModule?: AppModule
}

export function BottomNav({ isHome, currentModule }: BottomNavProps) {
  const useModuleNav = !isHome && currentModule?.navItems

  const navItems = useModuleNav
    ? currentModule.navItems!.map(item => ({
        to: item.path,
        icon: item.icon,
        label: item.label,
      }))
    : [
        { to: '/', icon: LayoutDashboard, label: '仪表盘' },
        { to: '/ai', icon: Bot, label: 'AI 助手' },
        { to: '/servers', icon: Server, label: '服务器' },
      ]

  return (
    <nav className="bg-white/80 dark:bg-dark-surface-2/80 glass border-t border-gray-200/60 dark:border-white/[0.06] safe-bottom">
      <div className="flex items-center justify-around h-14">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/' || to === currentModule?.path}
            aria-label={label}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-16 h-full relative transition-colors ${
                isActive
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : 'text-gray-400 dark:text-gray-400 active:text-gray-600'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 w-5 h-0.5 bg-emerald-500 dark:bg-emerald-400 rounded-full" />
                )}
                <Icon size={21} strokeWidth={isActive ? 2 : 1.7} />
                <span className="text-[10px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
