export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
      <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
      <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
    </div>
  )
}
