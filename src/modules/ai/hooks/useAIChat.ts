import { useState, useCallback, useRef, useEffect } from 'react'
import { Preferences } from '@capacitor/preferences'
import { useServer } from '../../../core/contexts/ServerContext'
import { generateId } from '../../../core/utils'
import type { AIConfig, ChatMessage, ToolCallInfo, SSEToolCallData, SSEToolResultData } from '../types'

const CHAT_KEY_PREFIX = 'sm_ai_chat_'
const ARCHIVE_KEY_PREFIX = 'sm_ai_archive_'
const FREQ_KEY_PREFIX = 'sm_ai_freq_'
const MAX_ARCHIVES = 50

interface ChatHistory {
  chatId: string
  messages: ChatMessage[]
}

export interface ArchivedChat {
  id: string
  timestamp: number
  preview: string // first user message
  messageCount: number
  messages: ChatMessage[]
}

export function useAIChat(aiConfig: AIConfig) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [chatId, setChatId] = useState(() => `chat-${generateId()}`)
  const [isLoaded, setIsLoaded] = useState(false)
  const [frequentCommands, setFrequentCommands] = useState<string[]>([])
  const [archives, setArchives] = useState<ArchivedChat[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { getClient, activeServerId } = useServer()

  // Per-server storage keys
  const storageKey = activeServerId ? `${CHAT_KEY_PREFIX}${activeServerId}` : null
  const archiveKey = activeServerId ? `${ARCHIVE_KEY_PREFIX}${activeServerId}` : null
  const freqKey = activeServerId ? `${FREQ_KEY_PREFIX}${activeServerId}` : null

  // Load chat history + archives + frequent commands when server changes
  useEffect(() => {
    setIsLoaded(false)
    setMessages([])
    setChatId(`chat-${generateId()}`)
    setFrequentCommands([])
    setArchives([])

    if (!storageKey || !archiveKey || !freqKey) {
      setIsLoaded(true)
      return
    }

    Promise.all([
      Preferences.get({ key: storageKey }),
      Preferences.get({ key: archiveKey }),
      Preferences.get({ key: freqKey }),
    ]).then(([chatRes, archiveRes, freqRes]) => {
      // Restore active chat
      if (chatRes.value) {
        try {
          const history: ChatHistory = JSON.parse(chatRes.value)
          setMessages(history.messages.map(m => ({ ...m, isStreaming: false })))
          setChatId(history.chatId)
        } catch { /* ignore */ }
      }
      // Restore archives
      if (archiveRes.value) {
        try { setArchives(JSON.parse(archiveRes.value)) } catch { /* ignore */ }
      }
      // Restore frequent commands
      if (freqRes.value) {
        try {
          const freq: Record<string, number> = JSON.parse(freqRes.value)
          setFrequentCommands(topN(freq, 5))
        } catch { /* ignore */ }
      }
      setIsLoaded(true)
    })
  }, [storageKey, archiveKey, freqKey])

  // Save active chat (debounced)
  useEffect(() => {
    if (!isLoaded || !storageKey) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const toSave = messages.map(m => ({ ...m, isStreaming: false }))
      Preferences.set({ key: storageKey, value: JSON.stringify({ chatId, messages: toSave }) })
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [messages, chatId, isLoaded, storageKey])

  // Track command frequency
  const trackCommand = useCallback((content: string) => {
    if (!freqKey) return
    Preferences.get({ key: freqKey }).then(({ value }) => {
      const freq: Record<string, number> = value ? JSON.parse(value) : {}
      freq[content] = (freq[content] || 0) + 1
      Preferences.set({ key: freqKey, value: JSON.stringify(freq) })
      setFrequentCommands(topN(freq, 5))
    })
  }, [freqKey])

  const sendMessage = useCallback(async (content: string) => {
    const client = getClient()
    if (!client || !aiConfig.apiKey) return

    trackCommand(content)

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsProcessing(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await client.postStream('/api/ai/chat', {
        cli: aiConfig.cli,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
        model: aiConfig.model,
        prompt: content,
        chatId,
      }, abort.signal)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              processSSEEvent(eventType, data, assistantMsg.id, setMessages)
            } catch { /* skip */ }
            eventType = ''
          }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ))
    } catch (err: unknown) {
      if (abort.signal.aborted) return
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: m.content || `Error: ${errMsg}`, isStreaming: false }
          : m
      ))
    } finally {
      setIsProcessing(false)
      abortRef.current = null
    }
  }, [aiConfig, chatId, getClient, trackCommand])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setIsProcessing(false)
  }, [])

  // Clear = archive current conversation, then start fresh
  const clearMessages = useCallback(() => {
    const client = getClient()
    if (client) {
      client.post('/api/ai/clear-session', { chatId }).catch(() => {})
    }

    // Archive current conversation if it has content
    if (messages.length > 0 && archiveKey) {
      const firstUser = messages.find(m => m.role === 'user')
      const archived: ArchivedChat = {
        id: generateId(),
        timestamp: messages[0].timestamp,
        preview: firstUser?.content.slice(0, 60) || '(空对话)',
        messageCount: messages.length,
        messages: messages.map(m => ({ ...m, isStreaming: false })),
      }
      const updated = [archived, ...archives].slice(0, MAX_ARCHIVES)
      setArchives(updated)
      Preferences.set({ key: archiveKey, value: JSON.stringify(updated) })
    }

    setMessages([])
    setChatId(`chat-${generateId()}`)
    if (storageKey) Preferences.remove({ key: storageKey })
  }, [chatId, getClient, messages, archives, archiveKey, storageKey])

  // Delete a single archived chat
  const deleteArchive = useCallback((archiveId: string) => {
    if (!archiveKey) return
    const updated = archives.filter(a => a.id !== archiveId)
    setArchives(updated)
    Preferences.set({ key: archiveKey, value: JSON.stringify(updated) })
  }, [archives, archiveKey])

  // Export conversation as markdown text
  const exportChat = useCallback((msgs?: ChatMessage[]) => {
    const target = msgs || messages
    if (target.length === 0) return

    const date = new Date(target[0].timestamp)
    const lines: string[] = [`# AI 对话记录 - ${formatDate(date)}`, '']

    for (const msg of target) {
      const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      const role = msg.role === 'user' ? '**用户**' : '**AI**'
      lines.push(`### ${role}  ${time}`)
      lines.push(msg.content)
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          lines.push(`\n> 🔧 ${tc.name}`)
          if (tc.result) lines.push(`> ${tc.result.slice(0, 200)}`)
        }
      }
      lines.push('')
    }

    const text = lines.join('\n')
    downloadFile(`chat-${formatDate(date)}.md`, text)
  }, [messages])

  return {
    messages, isProcessing, sendMessage, stopGeneration, clearMessages,
    frequentCommands, archives, deleteArchive, exportChat,
  }
}

// --- Helpers ---

function topN(freq: Record<string, number>, n: number): string[] {
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([cmd]) => cmd)
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// --- SSE event processor ---

function processSSEEvent(
  eventType: string,
  data: Record<string, unknown>,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) {
  switch (eventType) {
    case 'tool_call': {
      const tc = data as unknown as SSEToolCallData
      const toolCall: ToolCallInfo = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: 'running',
      }
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
          : m
      ))
      break
    }
    case 'tool_result': {
      const tr = data as unknown as SSEToolResultData
      setMessages(prev => prev.map(m => {
        if (m.id !== assistantId) return m
        const toolCalls = (m.toolCalls || []).map(tc =>
          tc.id === tr.id
            ? { ...tc, result: tr.result, error: tr.error, status: (tr.error ? 'error' : 'done') as ToolCallInfo['status'] }
            : tc
        )
        return { ...m, toolCalls }
      }))
      break
    }
    case 'content_delta': {
      const content = data.content as string
      if (content) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: m.content + content }
            : m
        ))
      }
      break
    }
    case 'done': {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, isStreaming: false } : m
      ))
      break
    }
    case 'error': {
      const errMsg = data.message as string || 'Unknown error'
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: m.content || `Error: ${errMsg}`, isStreaming: false }
          : m
      ))
      break
    }
  }
}
