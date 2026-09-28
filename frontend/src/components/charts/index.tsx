import * as React from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { AlertTriangle, Database, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/api/client'
import { ApiErrorState } from '@/components/errors/states'

/*
 * Chart wrapper system (spec §43) — every panel in the app composes these so
 * spacing, headers, legends, tooltips and state handling stay identical.
 */

/* --------------------------------- Card ----------------------------------- */

interface ChartCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  subtitle?: string
  /** Right-aligned slot (model metadata, endpoints, actions). */
  actions?: React.ReactNode
  contentClassName?: string
  loading?: boolean
}

/**
 * ChartCard — glass container with a mandatory title/subtitle pair so no
 * chart renders without context (spec §16).
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  className,
  contentClassName,
  children,
  ...props
}: ChartCardProps) {
  return (
    <div className={cn('glass-card flex flex-col p-5', className)} {...props}>
      <ChartHeader title={title} subtitle={subtitle} actions={actions} />
      <div className={cn('mt-3 flex-1', contentClassName)}>{children}</div>
    </div>
  )
}

/* -------------------------------- Header ---------------------------------- */

export function ChartHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold tracking-tight text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/* -------------------------------- Legend ---------------------------------- */

export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string; hint?: string }[]
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
          {item.hint && <span className="text-subtle">· {item.hint}</span>}
        </li>
      ))}
    </ul>
  )
}

/* --------------------------------- Empty ----------------------------------- */

export function ChartEmpty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
      <Database className="h-5 w-5 text-subtle" aria-hidden />
      <p className="text-sm font-medium text-muted">{message}</p>
      {hint && <p className="max-w-sm text-xs text-subtle">{hint}</p>}
    </div>
  )
}

/* --------------------------------- Error ----------------------------------- */

export function ChartError({
  message = 'Unable to load chart data.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-critical/30 bg-critical/5 p-6 text-center">
      <AlertTriangle className="h-5 w-5 text-critical" aria-hidden />
      <p className="text-sm font-medium text-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden /> Retry
        </Button>
      )}
    </div>
  )
}

/**
 * ChartErrorFrom — error-aware chart state. Empty-data API responses
 * (ApiError kind 'no_data') render as contextual empty states; genuine
 * failures render as errors with retry (spec §16/§18).
 */
export function ChartErrorFrom({
  error,
  onRetry,
  fallbackMessage,
}: {
  error: unknown
  onRetry?: () => void
  fallbackMessage?: string
}) {
  if (error instanceof ApiError && error.kind === 'no_data') {
    return <ChartEmpty message={error.message} hint="Adjust the filters and try again." />
  }
  if (error instanceof ApiError) return <ApiErrorState error={error} retry={onRetry} />
  return <ChartError message={fallbackMessage} onRetry={onRetry} />
}

/* -------------------------------- Skeleton --------------------------------- */

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex flex-col gap-3" style={{ minHeight: height }} aria-busy="true" aria-live="polite">
      <div className="flex-1">
        <Skeleton className="h-full w-full" style={{ minHeight: height }} />
      </div>
      <div className="flex items-center gap-2 text-xs text-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading analytics…
      </div>
    </div>
  )
}

/* -------------------------------- Sparkline -------------------------------- */

interface SparklineProps {
  points: number[]
  color?: string
  height?: number
  className?: string
}

/**
 * Sparkline — minimal trend strip for KPI cards. Purely presentational:
 * the series comes straight from the API KPI payload.
 */
export function Sparkline({ points, color, height = 36, className }: SparklineProps) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const stroke = color ?? theme.series.primary

  if (!points || points.length === 0) return null

  return (
    <div className={cn('w-full', className)} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points.map((v) => ({ v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${stroke.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.6}
            fill={`url(#spark-${stroke.replace(/[^a-zA-Z0-9]/g, '')})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
