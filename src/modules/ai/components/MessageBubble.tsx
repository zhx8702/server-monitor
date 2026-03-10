import { User, Bot } from 'lucide-react'
import type { ChatMessage } from '../types'
import { ToolCallCard } from './ToolCallCard'
import { TypingIndicator } from './TypingIndicator'

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        isUser ? 'bg-emerald-600' : 'bg-zinc-700'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-white" />
          : <Bot className="w-3.5 h-3.5 text-zinc-300" />
        }
      </div>

      {/* Content */}
      <div className={`max-w-[85%] min-w-0 ${isUser ? 'items-end' : ''}`}>
        {isUser ? (
          <div className="bg-emerald-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Tool calls */}
            {message.toolCalls?.map(tc => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}

            {/* Text content */}
            {message.content && (
              <div className="bg-zinc-800 text-zinc-200 rounded-2xl rounded-tl-sm px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
                {message.content}
              </div>
            )}

            {/* Typing indicator when streaming with no content yet */}
            {message.isStreaming && !message.content && !(message.toolCalls?.length) && (
              <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-1 py-0.5">
                <TypingIndicator />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
