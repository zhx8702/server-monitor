import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useServer } from '../contexts/ServerContext'
import { applyAdapter } from '../api/adapters'

export function useAgentQuery<T>(
  path: string,
  params?: Record<string, string>,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>,
) {
  const { activeServerId, getClient } = useServer()
  const client = getClient()

  return useQuery({
    queryKey: ['agent', activeServerId, path, params],
    queryFn: async () => {
      if (!client) throw new Error('No active server')
      const raw = await client.request<unknown>(path, params)
      return applyAdapter<T>(path, raw)
    },
    enabled: !!client && (options?.enabled !== false),
    ...options,
  })
}
