import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatPct } from '@/lib/formatters'
import type { WastageCategoryRow } from '@/api/types'

/**
 * WastageByCategory — share of total wasted cost per category as CSS bars
 * (GET /api/intelligence/wastage → byCategory). Bar width is the API's
 * shareOfWastage (0–1) scaled to percent; ordering follows the API response.
 * Each row also shows the category's own wastage % (right, mono) and its top
 * wasted item as the sub-line, both verbatim from the API.
 */
export function WastageByCategory({
  rows,
  loading,
  error,
  onRetry,
  className,
}: {
  rows?: WastageCategoryRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Wastage by Category'
  const subtitle = 'Share of total wasted cost · category wastage % on the right'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load wastage categories." />
      </ChartCard>
    )
  }
  if (loading || !rows) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No wastage category data for the selected filters." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-y-auto dineiq-scrollbar"
      actions={<span className="font-mono text-[10px] text-subtle">{rows.length} categories</span>}
    >
      <ul className="flex flex-col gap-3" aria-label="Wastage share by category">
        {rows.map((c) => (
          <li key={c.categoryId} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-semibold text-foreground">{c.category}</span>
              <span className="font-mono text-[11px] text-muted">
                {formatPKR(c.wastageCost, { compact: true })} · {formatPct(c.wastagePct)}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-strong"
              role="img"
              aria-label={`${c.category}: ${Math.round(c.shareOfWastage * 100)}% of total wastage`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-negative/70 to-negative"
                style={{ width: `${Math.max(2, c.shareOfWastage * 100)}%` }}
              />
            </div>
            <p className="text-[10px] leading-snug text-subtle">Top: {c.topItem}</p>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
