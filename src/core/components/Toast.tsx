import { useToast, type ToastType } from '../contexts/ToastContext'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
}

const colors: Record<ToastType, string> = {
  success: 'bg-emerald-500 shadow-emerald-500/25',
  error: 'bg-rose-500 shadow-rose-500/25',
  info: 'bg-teal-500 shadow-teal-500/25',
}

export function ToastContainer() {
  const { toasts, dismiss } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[90vw] max-w-sm" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
      {toasts.map(t => {
        const Icon = icons[t.type]
        return (
          <div
            key={t.id}
            className={`${colors[t.type]} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up`}
          >
            <Icon size={18} className="shrink-0" />
            <span className="text-sm flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100 transition-opacity">
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
