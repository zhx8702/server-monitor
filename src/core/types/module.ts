import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface AppModule {
  name: string
  label: string
  icon: LucideIcon
  path: string
  routes: ModuleRoute[]
  navItems?: NavItem[]
  order?: number
}

export interface ModuleRoute {
  index?: boolean
  path?: string
  element: ReactNode
}

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}
