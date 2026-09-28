import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatPct, humanize } from '@/lib/formatters'
import type { WastageOutletRow } from '@/api/types'

/**
 * WastageOutletsTable — per-outlet wastage cost and rate
 * (GET /api/intelligence/wastage → byOutlet). Rows are re-sorted by wastage cost
 * descending client-side — a presentation-only choice (the API order is by
 * outlet id). The rose badge renders ONLY when the API ships
 * `flag: 'wastage_abnormal'`; any other flag value renders a dash rather than
 * an invented label.
 */
export function WastageOutletsTable({
  rows,
  loading,
  error,
  onRetry,
  className,
}: {
  rows?: WastageOutletRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Outlet Wastage'
  const subtitle = 'Per-outlet wasted cost and rate across the estate'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load outlet wastage." />
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
        <ChartEmpty message="No outlet wastage data for the selected filters." />
      </ChartCard>
    )
  }

  // Presentation-only ordering: highest cost first.
  const view = [...rows].sort((a, b) => b.wastageCost - a.wastageCost)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-y-auto dineiq-scrollbar"
      actions={<span className="font-mono text-[10px] text-subtle">{rows.length} outlets</span>}
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Outlet</th>
            <th scope="col" className="py-2 pr-2 font-semibold">City</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Wastage %</th>
            <th scope="col" className="py-2 text-right font-semibold">Cost</th>
          </tr>
        </thead>
        <tbody>
          {view.map((r) => (
            <tr key={r.outletId} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2">
                <span className="font-medium text-foreground">{r.outlet}</span>
                {r.flag === 'wastage_abnormal' && (
                  <span className="ml-2 inline-block rounded-md bg-negative/15 px-1.5 py-0.5 text-[10px] font-bold text-negative">
                    {humanize(r.flag)}
                  </span>
                )}
              </td>
              <td className="py-2 pr-2 text-muted">{r.city}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{formatPct(r.wastagePct)}</td>
              <td className="py-2 text-right font-mono text-[11px] text-foreground">
                {formatPKR(r.wastageCost, { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
