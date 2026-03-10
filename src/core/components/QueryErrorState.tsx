import { AlertTriangle, RefreshCw } from 'lucide-react'

interface QueryErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function QueryErrorState({ message = '加载失败', onRetry }: QueryErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center mb-4">
        <AlertTriangle size={24} className="text-rose-500" />
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{message}</p>
      <p className="text-xs text-gray-400 dark:text-gray-400 mb-4">请检查网络连接或稍后再试</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:bg-emerald-100 dark:active:bg-emerald-500/20 transition-colors"
        >
          <RefreshCw size={14} />
          重试
        </button>
      )}
    </div>
  )
}
