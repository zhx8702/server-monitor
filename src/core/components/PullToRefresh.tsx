import { useState, useRef, useCallback, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void
  children: ReactNode
}

const THRESHOLD = 60
const MAX_PULL = 100
const PULL_MULTIPLIER = 0.5
const REFRESH_TIMEOUT = 15_000

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const isPulling = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isAtTop = useCallback((): boolean => {
    const el = containerRef.current
    if (!el) return false
    return el.scrollTop <= 0
  }, [])

  function handleTouchStart(e: React.TouchEvent) {
    if (refreshing) return
    if (isAtTop()) {
      startY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isPulling.current || refreshing) return
    if (!isAtTop() && pullDistance === 0) {
      isPulling.current = false
      return
    }
    const diff = e.touches[0].clientY - startY.current
    if (diff > 0) {
      setPullDistance(Math.min(diff * PULL_MULTIPLIER, MAX_PULL))
    } else {
      if (pullDistance === 0) isPulling.current = false
    }
  }

  async function handleTouchEnd() {
    if (!isPulling.current) return
    isPulling.current = false
    if (pullDistance >= THRESHOLD) {
      setRefreshing(true)
      setPullDistance(0)
      try {
        const result = onRefresh()
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          await Promise.race([
            result,
            new Promise(resolve => setTimeout(resolve, REFRESH_TIMEOUT)),
          ])
        }
      } finally {
        setRefreshing(false)
      }
    } else {
      setPullDistance(0)
    }
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
        style={{ height: refreshing ? 40 : pullDistance > 0 ? pullDistance : 0 }}
      >
        <RefreshCw
          size={20}
          className={`text-slate-400 transition-transform ${
            refreshing ? 'animate-spin' : pullDistance >= THRESHOLD ? 'rotate-180' : ''
          }`}
        />
      </div>
      {children}
    </div>
  )
}
