import { useState, useEffect, useCallback } from 'react'
import { Preferences } from '@capacitor/preferences'
import type { AIConfig } from '../types'

const AI_CONFIG_KEY = 'sm_ai_config'

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: '',
  endpoint: '',
  model: 'gpt-4o',
}

export function useAIConfig() {
  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    Preferences.get({ key: AI_CONFIG_KEY }).then(({ value }) => {
      if (value) {
        try {
          setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(value) })
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
