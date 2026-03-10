import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, '\n', errorInfo.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="h-full flex items-center justify-center p-6 bg-gray-50 dark:bg-dark-surface">
          <div className="text-center space-y-4 max-w-xs">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto">
              <AlertTriangle size={28} className="text-rose-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">页面出错了</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {this.state.error?.message || '发生未知错误'}
              </p>
            </div>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white active:bg-emerald-600 transition-colors"
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
