import type { ServerConfig } from '../types/server'

export class AgentError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentError'
    this.code = code
  }
}

export class AgentClient {
  private config: ServerConfig

  constructor(config: ServerConfig) {
    this.config = config
  }

  private get baseUrl(): string {
    if (import.meta.env.DEV) {
      return '/api/agent'
    }
    return `${this.config.protocol}://${this.config.host}:${this.config.port}`
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.config.token}`,
    }
    if (import.meta.env.DEV) {
      h['X-Agent-Url'] = `${this.config.protocol}://${this.config.host}:${this.config.port}`
      h['X-Agent-Token'] = this.config.token
    }
    return h
  }

  async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
      }
    }

    const res = await fetch(url.toString(), {
      headers: this.headers,
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 401) {
      throw new AgentError('AUTH_FAILED', '认证失败，请检查 Token')
    }
    if (!res.ok) {
      throw new AgentError('HTTP_ERROR', `HTTP ${res.status}: ${res.statusText}`)
    }

    return res.json()
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 401) {
      throw new AgentError('AUTH_FAILED', '认证失败，请检查 Token')
    }
    if (!res.ok) {
      const text = await res.text()
      let message = `HTTP ${res.status}: ${res.statusText}`
      try { message = JSON.parse(text).error || message } catch {}
      throw new AgentError('HTTP_ERROR', message)
    }

    return res.json()
  }

  async postStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    })

    if (res.status === 401) {
      throw new AgentError('AUTH_FAILED', '认证失败，请检查 Token')
    }
    if (!res.ok) {
      const text = await res.text()
      let message = `HTTP ${res.status}: ${res.statusText}`
      try { message = JSON.parse(text).error || message } catch {}
      throw new AgentError('HTTP_ERROR', message)
    }

    return res
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/api/health')
      return true
    } catch {
      return false
    }
  }
}
