interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-gray-200 dark:bg-white/[0.06] rounded ${className}`} />
  )
}

export function StatCardSkeleton() {
  return (
    <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 space-y-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-8 w-12" />
    </div>
  )
}

export function GaugeCardSkeleton() {
  return (
    <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4">
      <Skeleton className="h-4 w-16 mb-3" />
      <div className="flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-white/[0.06] animate-pulse" />
      </div>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <Skeleton className="h-6 w-40" />
      <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 space-y-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4">
      <Skeleton className="h-4 w-32 mb-3" />
      <Skeleton className="h-[180px] w-full rounded-lg" />
    </div>
  )
}
