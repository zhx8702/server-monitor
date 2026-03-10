import { usageColor, ringColor } from '../utils'

interface RingGaugeProps {
  value: number
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
}

export function RingGauge({ value, size = 96, strokeWidth = 8, label, sublabel }: RingGaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(value, 100) / 100)

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={strokeWidth}
            className="stroke-gray-100 dark:stroke-white/[0.06]"
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${ringColor(value)} transition-all duration-500`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-bold tabular-nums ${usageColor(value)}`}>
            {Math.round(value)}%
          </span>
        </div>
      </div>
      {label && <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{label}</span>}
      {sublabel && <span className="text-[10px] text-gray-400 dark:text-gray-500">{sublabel}</span>}
    </div>
  )
}
