import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { DishThumb } from '@/components/ui/dish-thumb'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { WastageItemRow } from '@/api/types'

/**
 * Wastage-% severity tint — thresholds fixed by the page spec: ≥8% rose
 * (critical), ≥5% amber (medium), otherwise muted. Purely presentational
 * mapping of a supplied value to a color ladder.
 */
function wastagePctTone(pct: number): string {
  if (pct >= 8) return 'font-semibold text-negative'
  if (pct >= 5) return 'font-medium text-medium'
  return 'text-muted'
}

/**
 * WastageItemsTable — item-level wastage rows in API order
 * (GET /api/intelligence/wastage → byItem). Wastage %, cost, prepared and wasted
 * quantities are all verbatim API values; the only client-side logic is the
 * severity tint on the wastage-% column.
 */
export function WastageItemsTable({
  rows,
  loading,
  error,
  onRetry,
  className,
}: {
  rows?: WastageItemRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Item Wastage'
  const subtitle = 'Item-level wastage rate, cost and prepared vs wasted quantity'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load item wastage." />
      </ChartCard>
    )
  }
  if (loading || !rows) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }
  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No item wastage data for the selected filters." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-y-auto dineiq-scrollbar"
      actions={<span className="font-mono text-[10px] text-subtle">{rows.length} items</span>}
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Category</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Wastage %</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Cost</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Prepared</th>
            <th scope="col" className="py-2 text-right font-semibold">Wasted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <DishThumb itemId={r.itemId} name={r.name} size="sm" />
                  <span className="truncate">{r.name}</span>
                </span>
              </td>
              <td className="py-2 pr-2 text-muted">{r.category}</td>
              <td className={cn('py-2 pr-2 text-right font-mono text-[11px]', wastagePctTone(r.wastagePct))}>
                {formatPct(r.wastagePct)}
              </td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-foreground">
                {formatPKR(r.wastageCost, { compact: true })}
              </td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{formatInt(r.preparedQty)}</td>
              <td className="py-2 text-right font-mono text-[11px] text-muted">{formatInt(r.wastedQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
