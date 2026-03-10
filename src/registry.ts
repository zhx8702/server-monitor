import type { AppModule } from './core/types/module'
import { dashboardModule } from './modules/dashboard'
import { aiModule } from './modules/ai'
import { serversModule } from './modules/servers'

export const modules: AppModule[] = [
  dashboardModule,
  aiModule,
  serversModule,
].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
