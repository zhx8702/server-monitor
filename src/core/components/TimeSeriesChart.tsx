import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { formatTimeShort } from '../utils'
import type { ReactNode } from 'react'

interface ChartLine {
  dataKey: string
  color: string
  name: string
}

interface TimeSeriesChartProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  data: Record<string, unknown>[]
  lines: ChartLine[]
  height?: number
  yDomain?: [number, number]
  yUnit?: string
  yFormatter?: (value: number) => string
}

export function TimeSeriesChart({
  title,
  subtitle,
  icon,
  data,
  lines,
  height = 180,
  yDomain,
  yUnit = '%',
  yFormatter,
}: TimeSeriesChartProps) {
  const isDark = document.documentElement.classList.contains('dark')
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const textColor = isDark ? '#8b949e' : '#9098a8'

  return (
    <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-gray-500 dark:text-gray-400">{icon}</span>}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      {subtitle && <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">{subtitle}</p>}

      {data.length === 0 ? (
        <div className="flex items-center justify-center" style={{ height }}>
          <span className="text-xs text-gray-400">等待数据...</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
            <defs>
              {lines.map(line => (
                <linearGradient key={`grad-${line.dataKey}`} id={`grad-${line.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={line.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={line.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="ts"
              tickFormatter={(ts) => formatTimeShort(ts as number)}
              tick={{ fontSize: 10, fill: textColor }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={yDomain}
              tickFormatter={yFormatter}
              tick={{ fontSize: 10, fill: textColor }}
              axisLine={false}
              tickLine={false}
              unit={yUnit}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#131a21' : '#ffffff',
                border: `1px solid ${isDark ? '#1b2630' : '#e4e7ec'}`,
                borderRadius: '12px',
                fontSize: '12px',
                color: isDark ? '#e6edf3' : '#1a1a2e',
              }}
              labelFormatter={(ts) => new Date((ts as number) * 1000).toLocaleTimeString('zh-CN')}
            />
            {lines.map(line => (
              <Area
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                stroke={line.color}
                fill={`url(#grad-${line.dataKey})`}
                name={line.name}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {lines.length > 1 && (
        <div className="flex items-center justify-center gap-4 mt-2">
          {lines.map(line => (
            <div key={line.dataKey} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
              <span className="text-[10px] text-gray-400">{line.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
