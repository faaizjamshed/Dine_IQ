import { formatDecimal } from '@/lib/formatters'
import { useMemo, useState } from 'react'
import { Minus, Search, TrendingDown, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ChartCard, ChartSkeleton } from '@/components/charts'
import { Input } from '@/components/ui/input'
import { DishThumb } from '@/components/ui/dish-thumb'
import { formatInt, formatDelta } from '@/lib/formatters'
import type { ForecastItemRow } from '@/api/types'
import { cn } from '@/lib/utils'

const TREND_META: Record<ForecastItemRow['trend'], { icon: LucideIcon; badge: string; delta: string; label: string }> = {
  rising: { icon: TrendingUp, badge: 'bg-positive/15 text-positive', delta: 'text-positive', label: 'Rising' },
  stable: { icon: Minus, badge: 'bg-low/15 text-low', delta: 'text-muted', label: 'Stable' },
  falling: { icon: TrendingDown, badge: 'bg-negative/15 text-negative', delta: 'text-negative', label: 'Falling' },
}

/**
 * ForecastItemsTable — per-item 7-day demand outlook
 * (GET /api/ml/demand-comparison → items). Quantities, deltas and the trend
 * flag are model estimates supplied by the API; the trend field decides the
 * delta coloring so the frontend never re-derives direction from the delta.
 *
 * The search input is a LOCAL view filter over the already-fetched rows —
 * it never changes the query or the API payload.
 */
export function ForecastItemsTable({
  items,
  loading,
  className,
}: {
  items?: ForecastItemRow[]
  loading?: boolean
  className?: string
}) {
  const title = 'Item-Level Forecast (Next 7 Days)'
  const subtitle = 'Forecast quantity vs trailing 7-day actuals — model estimates'

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) => it.name.toLowerCase().includes(q) || it.category.toLowerCase().includes(q),
    )
  }, [items, query])

  if (loading || !items) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-auto dineiq-scrollbar"
      actions={
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            aria-label="Search forecast items"
            className="h-7 w-36 rounded-md pl-7 text-xs md:w-44"
          />
        </div>
      }
    >
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Category</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Actual (7d)</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Forecast (7d)</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Delta</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Conf.</th>
            <th scope="col" className="py-2 text-right font-semibold">Trend</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-xs text-subtle">
                No items match “{query}”.
              </td>
            </tr>
          ) : (
            filtered.map((it) => {
              const trend = TREND_META[it.trend]
              const TrendIcon = trend.icon
              return (
                <tr key={it.itemId} className="border-t border-border/60 text-xs">
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <DishThumb itemId={it.itemId} name={it.name} size="sm" />
                      <span className="truncate">{it.name}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-muted">{it.category}</td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                    {formatInt(it.actualQty)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] font-semibold text-foreground">
                    {formatInt(it.forecastQty)}
                  </td>
                  <td
                    className={cn(
                      'py-2 pr-2 text-right font-mono text-[11px] font-semibold',
                      trend.delta,
                    )}
                  >
                    {formatDelta(it.deltaPct)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                    {formatDecimal(it.confidence, 2)}
                  </td>
                  <td className="py-2 text-right">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                        trend.badge,
                      )}
                    >
                      <TrendIcon className="h-3 w-3" aria-hidden />
                      {trend.label}
                    </span>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[10px] text-subtle">
        Showing {filtered.length} of {items.length} items · trend flag from the API
      </p>
    </ChartCard>
  )
}
