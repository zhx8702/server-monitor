import { useState, useCallback, useRef } from 'react'
import { useServer } from '../../../core/contexts/ServerContext'
import { generateId } from '../../../core/utils'
import type { AIConfig, ChatMessage, ToolCallInfo, SSEToolCallData, SSEToolResultData } from '../types'

export function useAIChat(aiConfig: AIConfig) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const { getClient } = useServer()

  const sendMessage = useCallback(async (content: string) => {
    const client = getClient()
    if (!client || !aiConfig.apiKey) return

    // Add user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    // Create assistant placeholder
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
      // Build message history for the API (exclude isStreaming/toolCalls metadata)
      const apiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }))

      const res = await client.postStream('/api/ai/chat', {
        provider: {
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          endpoint: aiConfig.endpoint,
          model: aiConfig.model,
        },
        messages: apiMessages,
      }, abort.signal)

      // Read SSE stream
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep incomplete line

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            const dataStr = line.slice(6)
            try {
              const data = JSON.parse(dataStr)
              processSSEEvent(eventType, data, assistantMsg.id, setMessages)
            } catch {
              // skip malformed data
            }
            eventType = ''
          }
        }
      }

      // Mark streaming complete
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ))
    } catch (err: unknown) {
      if (abort.signal.aborted) return // user cancelled
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
  }, [messages, aiConfig, getClient])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setIsProcessing(false)
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, isProcessing, sendMessage, stopGeneration, clearMessages }
}

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
