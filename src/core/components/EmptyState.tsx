import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-gray-300 dark:text-gray-600 mb-4">
        {icon}
      </div>
      <h3 className="text-base font-medium text-gray-500 dark:text-gray-400">{title}</h3>
      {description && (
        <p className="text-sm text-gray-400 dark:text-gray-400 mt-1">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
