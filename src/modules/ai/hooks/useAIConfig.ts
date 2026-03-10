import { useState, useEffect, useCallback } from 'react'
import { Preferences } from '@capacitor/preferences'
import type { AIConfig } from '../types'

const AI_CONFIG_KEY = 'sm_ai_config'

const DEFAULT_CONFIG: AIConfig = {
  cli: 'claude',
  apiKey: '',
  endpoint: '',
  model: 'claude-sonnet-4-20250514',
}

export function useAIConfig() {
  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    Preferences.get({ key: AI_CONFIG_KEY }).then(({ value }) => {
      if (value) {
        try {
          const saved = JSON.parse(value)
          // Migrate old config format
          if (saved.provider && !saved.cli) {
            saved.cli = 'claude'
            delete saved.provider
          }
          setConfig({ ...DEFAULT_CONFIG, ...saved })
        } catch {
          // ignore parse errors
        }
      }
      setIsLoaded(true)
    })
  }, [])

  const updateConfig = useCallback(async (updates: Partial<AIConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...updates }
      Preferences.set({ key: AI_CONFIG_KEY, value: JSON.stringify(next) })
      return next
    })
  }, [])

  const isConfigured = config.apiKey.length > 0

  return { config, updateConfig, isConfigured, isLoaded }
}
