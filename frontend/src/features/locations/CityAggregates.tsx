import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import type { CityAggregate } from '@/api/types'

/**
 * CityAggregates — per-city rollup table
 * (GET /api/reports/locations_menu → data.cityAggregates).
 *
 * Columns: City · Outlets · Revenue (compact PKR) · Share % (tiny CSS bar,
 * scaled to the largest share in scope) · Avg margin % · Best / Worst outlet
 * (two-line cell, emerald = best, rose = worst). Every value is rendered
 * verbatim from the API — the frontend computes nothing but the bar scale.
 */
export function CityAggregates({
  cities,
  loading,
  error,
  onRetry,
  className,
}: {
  cities?: CityAggregate[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'City Aggregates'
  const subtitle = 'Revenue, share and margin rolled up by city'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load city aggregates." />
      </ChartCard>
    )
  }
  if (loading || !cities) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }
  if (cities.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No city data for the selected filters." />
      </ChartCard>
    )
  }

  const maxShare = Math.max(...cities.map((c) => c.revenueShare))

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="flex flex-col gap-2.5"
    >
      <div className="overflow-x-auto dineiq-scrollbar">
        {/* Min width keeps the six columns legible at 390px; scroll stays inside the card. */}
        <div className="min-w-[460px]">
          <div className="grid grid-cols-[1.1fr_0.55fr_0.85fr_0.95fr_0.7fr_1.35fr] gap-2 border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-wide text-subtle">
            <span>City</span>
            <span className="text-right">Outlets</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">Share</span>
            <span className="text-right">Margin</span>
            <span>Best / Worst</span>
          </div>
          {cities.map((c) => (
            <div
              key={c.city}
              className="grid grid-cols-[1.1fr_0.55fr_0.85fr_0.95fr_0.7fr_1.35fr] items-center gap-2 border-b border-border/40 py-2 last:border-b-0"
            >
              <span className="truncate text-xs font-semibold text-foreground" title={c.city}>
                {c.city}
              </span>
              <span className="text-right font-mono text-[11px] text-muted">{formatInt(c.outlets)}</span>
              <span className="text-right font-mono text-[11px] text-muted">
                {formatPKR(c.revenue, { compact: true })}
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-mono text-[11px] text-muted">{Math.round(c.revenueShare * 100)}%</span>
                <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-strong" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (c.revenueShare / maxShare) * 100)}%` }}
                  />
                </span>
              </span>
              <span className="text-right font-mono text-[11px] text-muted">{formatPct(c.avgMarginPct)}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
                  <span className="truncate" title={c.bestOutlet}>
                    {c.bestOutlet}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-subtle">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-negative" />
                  <span className="truncate" title={c.worstOutlet}>
                    {c.worstOutlet}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-subtle">
        Green dot = best outlet · rose dot = worst outlet (by revenue, computed by the backend)
      </p>
    </ChartCard>
  )
}
