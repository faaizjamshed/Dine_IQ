import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatInt, formatPKR, formatPct } from '@/lib/formatters'
import type { PipelineMetric } from '@/api/types'

/**
 * Presentational value formatting per API-supplied unit — routes each metric
 * value to the matching shared formatter. The number itself is never
 * reinterpreted; only its display changes.
 */
function formatMetricValue(value: number, unit: string): string {
  if (unit === 'orders' || unit === 'score') return Number.isFinite(value) ? value.toFixed(3) : '—'
  if (unit === 'PKR') return formatPKR(value)
  if (unit === '%') return formatPct(value)
  if (unit === 'GB') return value.toFixed(1)
  return formatInt(value)
}

/**
 * Single comparison bar. IMPORTANT (data integrity): the width is normalized
 * per metric row (value ÷ max of the two engines) for readability ONLY — the
 * real value is always printed in mono at the bar end, so no magnitude is
 * ever communicated by width alone.
 */
function MetricBar({
  engine,
  value,
  max,
  color,
  leads,
  unit,
}: {
  engine: string
  value: number
  max: number
  color: string
  leads: boolean
  unit: string
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 font-mono text-[10px] text-muted">{engine}</span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-strong"
        role="img"
        aria-label={`${engine}: ${formatMetricValue(value, unit)} ${unit}`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${value > 0 ? Math.max(2, pct) : 0}%`, backgroundColor: color }}
        />
      </div>
      <span className="data-value w-20 shrink-0 text-right text-[11px] text-foreground">
        {formatMetricValue(value, unit)}
      </span>
      {/* Fixed slot keeps Spark/Python bars aligned across the two rows. */}
      <span className="w-11 shrink-0 text-right">
        {leads && (
          <span className="inline-block rounded bg-positive/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-positive">
            leads
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * MetricsComparison — head-to-head engine metrics from
 * GET /api/ml/demand-comparison → metrics. One row per metric with two CSS bars
 * (Spark = violet, Python = sky). Bars are per-row normalized for readability
 * only — real values are printed at the bar ends. The API's `better` side
 * gets an emerald "leads" badge (a `tie` gets none). The optional `note`
 * field is rendered verbatim as a sub-line.
 */
export function MetricsComparison({
  metrics,
  loading,
  error,
  onRetry,
  className,
}: {
  metrics?: PipelineMetric[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Engine Metrics — Spark vs Python'
  const subtitle = 'Per-metric comparison · bar widths normalized per row for readability, real values printed'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load engine metrics." />
      </ChartCard>
    )
  }
  if (loading || !metrics) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }
  if (metrics.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No engine metrics available in the parity audit payload." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-subtle">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: theme.series.violet }} />
          Spark
          <span aria-hidden className="ml-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: theme.series.sky }} />
          Python
        </span>
      }
    >
      <ul className="flex flex-col gap-4" aria-label="Engine metric comparison">
        {metrics.map((m) => {
          const rowMax = Math.max(m.sparkValue, m.pythonValue)
          return (
            <li key={m.metric} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{m.metric}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-subtle">{m.unit}</span>
              </div>
              <MetricBar
                engine="Spark"
                value={m.sparkValue}
                max={rowMax}
                color={theme.series.violet}
                leads={m.better === 'spark'}
                unit={m.unit}
              />
              <MetricBar
                engine="Python"
                value={m.pythonValue}
                max={rowMax}
                color={theme.series.sky}
                leads={m.better === 'python'}
                unit={m.unit}
              />
              {m.note && <p className="text-[10px] leading-snug text-subtle">{m.note}</p>}
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
