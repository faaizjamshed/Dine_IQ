import * as React from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme, performanceClassColor } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatInt, formatPct, formatRating, humanize } from '@/lib/formatters'
import type { OutletComparison } from '@/api/types'
import { cn } from '@/lib/utils'

/**
 * OutletComparisonTable — the outlet comparison feed
 * (GET /api/restaurants → data.outlets).
 *
 * Columns: Outlet (performance-class dot + name) · City · Revenue · Orders ·
 * AOV · Margin % · Rating · Flags (badges, rose tint). The dot color follows
 * the API performance class (profit_driver=emerald, volume_driver=sky,
 * hidden_opportunity=violet, low_performer=rose) — same encoding as the menu
 * items table.
 *
 * Search is a presentation-level affordance over name/city only; values are
 * never recomputed client-side. The head is sticky and the body scrolls
 * inside the card (max-h-96) so long outlet lists never overflow the page.
 */
export function OutletComparisonTable({
  outlets,
  loading,
  error,
  onRetry,
  className,
}: {
  outlets?: OutletComparison[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const [search, setSearch] = React.useState('')

  const title = 'Outlet Comparison'
  const subtitle = 'All outlets in scope, ranked by revenue'

  const rows = React.useMemo(() => {
    if (!outlets) return []
    const q = search.trim().toLowerCase()
    if (!q) return outlets
    return outlets.filter(
      (o) => o.name.toLowerCase().includes(q) || o.city.toLowerCase().includes(q),
    )
  }, [outlets, search])

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load outlet comparison." />
      </ChartCard>
    )
  }

  if (loading || outlets === undefined) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className} contentClassName="flex flex-col">
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="flex flex-col"
    >
      {/* Local search — narrows the API rows by outlet name or city */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search outlets or cities…"
          aria-label="Search outlets by name or city"
          className="h-9 pl-8 text-xs"
        />
      </div>

      {rows.length === 0 ? (
        <ChartEmpty
          message="No outlets match the current search."
          hint="Clear the search box to see every outlet in scope."
        />
      ) : (
        <div className="-mx-1 max-h-96 overflow-auto rounded-xl border border-border dineiq-scrollbar">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Outlets with revenue, orders, average order value, margin, rating, performance class and flags
            </caption>
            <thead className="sticky top-0 z-10 bg-background-subtle/95 backdrop-blur-sm">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-subtle">Outlet</th>
                <th scope="col" className="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-subtle sm:table-cell">City</th>
                <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">Revenue</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle md:table-cell">Orders</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle md:table-cell">AOV</th>
                <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">Margin</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle lg:table-cell">Rating</th>
                <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, index) => (
                <tr
                  key={o.id}
                  className={cn(
                    'border-b border-border/60 transition-colors hover:bg-surface-strong/70',
                    index % 2 === 1 && 'bg-surface/40',
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: performanceClassColor(o.performanceClass, theme) }}
                        title={o.performanceClass.replace('_', ' ')}
                      />
                      <span className="max-w-[150px] truncate text-xs font-semibold text-foreground" title={o.name}>
                        {o.name}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-muted sm:table-cell">{o.city}</td>
                  <td className="data-value px-3 py-2 text-right text-xs font-semibold text-foreground">
                    {formatPKR(o.revenue, { compact: true })}
                  </td>
                  <td className="data-value hidden px-3 py-2 text-right text-xs text-muted md:table-cell">
                    {formatInt(o.orders)}
                  </td>
                  <td className="data-value hidden px-3 py-2 text-right text-xs text-muted md:table-cell">
                    {formatPKR(o.aov)}
                  </td>
                  <td className="data-value px-3 py-2 text-right text-xs text-foreground">
                    {formatPct(o.profitMarginPct)}
                  </td>
                  <td className="data-value hidden px-3 py-2 text-right text-xs text-muted lg:table-cell">
                    {formatRating(o.rating)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {o.flags && o.flags.length > 0 ? (
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        {o.flags.map((flag) => (
                          <Badge key={flag} variant="negative" className="normal-case">
                            {humanize(flag)}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
        Dot color = API performance class · flags rendered verbatim from GET /api/restaurants
      </p>
    </ChartCard>
  )
}
