import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'
import type { ServerConfig } from '../types/server'
import { AgentClient } from '../api/agent-client'
import { generateId } from '../utils'

const SERVERS_KEY = 'sm_servers'
const ACTIVE_KEY = 'sm_active_server'

interface ServerContextValue {
  servers: ServerConfig[]
  activeServerId: string | null
  groups: string[]
  isLoading: boolean
  addServer: (config: Omit<ServerConfig, 'id'>) => void
  removeServer: (id: string) => void
  updateServer: (id: string, updates: Partial<ServerConfig>) => void
  setActiveServer: (id: string) => void
  getClient: (id?: string) => AgentClient | null
}

const ServerContext = createContext<ServerContextValue | null>(null)

const clientCache = new Map<string, AgentClient>()

function getOrCreateClient(config: ServerConfig): AgentClient {
  const key = `${config.id}-${config.host}-${config.port}-${config.token}`
  let client = clientCache.get(key)
  if (!client) {
    client = new AgentClient(config)
    clientCache.set(key, client)
  }
  return client
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<ServerConfig[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const { value: serversJson } = await Preferences.get({ key: SERVERS_KEY })
        const { value: activeId } = await Preferences.get({ key: ACTIVE_KEY })
        const loaded: ServerConfig[] = serversJson ? JSON.parse(serversJson) : []
        setServers(loaded)
        if (activeId && loaded.some(s => s.id === activeId)) {
          setActiveServerId(activeId)
        } else if (loaded.length > 0) {
          setActiveServerId(loaded[0].id)
        }
      } catch (e) {
        console.error('Failed to load servers:', e)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const persist = useCallback(async (list: ServerConfig[], activeId: string | null) => {
    await Preferences.set({ key: SERVERS_KEY, value: JSON.stringify(list) })
    if (activeId) {
      await Preferences.set({ key: ACTIVE_KEY, value: activeId })
    }
  }, [])

  const addServer = useCallback((config: Omit<ServerConfig, 'id'>) => {
    const newServer: ServerConfig = { ...config, id: generateId() }
    setServers(prev => {
      const next = [...prev, newServer]
      persist(next, activeServerId || newServer.id)
      return next
    })
    if (!activeServerId) {
      setActiveServerId(newServer.id)
    }
  }, [activeServerId, persist])

  const removeServer = useCallback((id: string) => {
    setServers(prev => {
      const next = prev.filter(s => s.id !== id)
      const newActive = activeServerId === id ? (next[0]?.id ?? null) : activeServerId
      setActiveServerId(newActive)
      persist(next, newActive)
      return next
    })
  }, [activeServerId, persist])

  const updateServer = useCallback((id: string, updates: Partial<ServerConfig>) => {
    setServers(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...updates } : s)
      persist(next, activeServerId)
      // Clear cached client so it gets recreated with new config
      for (const key of clientCache.keys()) {
        if (key.startsWith(id + '-')) {
          clientCache.delete(key)
        }
      }
      return next
    })
  }, [activeServerId, persist])

  const setActive = useCallback((id: string) => {
    setActiveServerId(id)
    Preferences.set({ key: ACTIVE_KEY, value: id })
  }, [])

  const getClient = useCallback((id?: string) => {
    const targetId = id ?? activeServerId
    if (!targetId) return null
    const config = servers.find(s => s.id === targetId)
    if (!config) return null
    return getOrCreateClient(config)
  }, [servers, activeServerId])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const s of servers) {
      if (s.group) set.add(s.group)
    }
    return Array.from(set)
  }, [servers])

  return (
    <ServerContext.Provider value={{
      servers, activeServerId, groups, isLoading,
      addServer, removeServer, updateServer,
      setActiveServer: setActive, getClient,
    }}>
      {children}
    </ServerContext.Provider>
  )
}

export function useServer() {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error('useServer must be used within ServerProvider')
  return ctx
}
