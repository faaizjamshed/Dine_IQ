import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatInt } from '@/lib/formatters'
import type { CustomerSegment } from '@/api/types'

/**
 * SegmentOverview — revenue contribution per behavioral segment
 * (GET /api/intelligence/customers → segments). Pure presentational bars; the
 * ordering and every figure come from the API response order.
 */
export function SegmentOverview({
  segments,
  loading,
  error,
  onRetry,
  className,
}: {
  segments?: CustomerSegment[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Segment Revenue Contribution'
  const subtitle = 'Historical revenue by source customer segment'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load customer segments." />
      </ChartCard>
    )
  }
  if (loading || !segments) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (segments.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No segment data for the selected filters." />
      </ChartCard>
    )
  }

  const maxRevenue = Math.max(...segments.map((s) => s.revenue))

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={<span className="font-mono text-[10px] text-subtle">{segments.length} segments</span>}
    >
      <ul className="flex flex-col gap-3" aria-label="Segment revenue contribution">
        {segments.map((s) => (
          <li key={s.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">{s.label}</span>
              <span className="font-mono text-[11px] text-muted">
                {formatPKR(s.revenue, { compact: true })} · {Math.round(s.revenueShare * 100)}% ·{' '}
                {formatInt(s.customers)} customers
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-strong"
              role="img"
              aria-label={`${s.label}: ${Math.round(s.revenueShare * 100)}% of revenue`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary-strong"
                style={{ width: `${Math.max(2, (s.revenue / maxRevenue) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] leading-snug text-subtle">{s.description}</p>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
