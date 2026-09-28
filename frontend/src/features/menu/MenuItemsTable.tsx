import * as React from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, ArrowDownRight, ChevronsUpDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DishThumb } from '@/components/ui/dish-thumb'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme, performanceClassColor } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatPct, formatInt, formatRating } from '@/lib/formatters'
import type { MenuItem, PerformanceClass } from '@/api/types'
import { cn } from '@/lib/utils'

/**
 * MenuItemsTable — every tracked item with its analytics row (spec §25).
 *
 * Presentation-only interactions (no business intelligence):
 *  - text search over name/category,
 *  - local performance-class filter (the GlobalFilters key `performanceClass`
 *    stays reserved for when the backend contract activates it),
 *  - client-side column sorting of API values.
 *
 * Virtualization: per spec §45, tables rendering MORE than 1000 rows are
 * windowed. The current dataset has 200 rows, so the plain
 * path renders — but the windowed path is implemented and activates
 * automatically if a backend payload exceeds the threshold.
 *
 * Data: GET /api/intelligence/menu → data.items.
 */

const VIRTUALIZE_ROW_LIMIT = 1000
const ROW_HEIGHT = 73
const VIEWPORT_HEIGHT = 520
const OVERSCAN = 6

type SortKey =
  | 'name'
  | 'category'
  | 'price'
  | 'revenue'
  | 'quantity'
  | 'marginPct'
  | 'rating'
  | 'trendPct'

const COLUMNS: { key: SortKey; label: string; numeric: boolean; className?: string }[] = [
  { key: 'name', label: 'Item', numeric: false },
  { key: 'category', label: 'Category', numeric: false, className: 'hidden md:table-cell' },
  { key: 'price', label: 'Price', numeric: true },
  { key: 'revenue', label: 'Revenue', numeric: true },
  { key: 'quantity', label: 'Qty', numeric: true, className: 'hidden sm:table-cell' },
  { key: 'marginPct', label: 'Margin', numeric: true },
  { key: 'rating', label: 'Rating', numeric: true, className: 'hidden md:table-cell' },
  { key: 'trendPct', label: '90d Trend', numeric: true, className: 'hidden lg:table-cell' },
]

const CLASS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All classes' },
  { value: 'profit_driver', label: 'Profit Drivers' },
  { value: 'volume_driver', label: 'Volume Drivers' },
  { value: 'hidden_opportunity', label: 'Hidden Opportunities' },
  { value: 'low_performer', label: 'Low Performers' },
]

function sortValue(item: MenuItem, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return item.name.toLowerCase()
    case 'category':
      return item.category.toLowerCase()
    default:
      return item[key]
  }
}

export function MenuItemsTable({
  items,
  loading,
  error,
  onRetry,
  className,
}: {
  items?: MenuItem[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  const [search, setSearch] = React.useState('')
  const [classFilter, setClassFilter] = React.useState('all')
  const [sortKey, setSortKey] = React.useState<SortKey>('revenue')
  const [sortDesc, setSortDesc] = React.useState(true)
  const [scrollTop, setScrollTop] = React.useState(0)

  const rows = React.useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    let list = items
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
    if (classFilter !== 'all') list = list.filter((i) => i.performanceClass === classFilter)
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDesc ? -cmp : cmp
    })
  }, [items, search, classFilter, sortKey, sortDesc])

  const virtualized = rows.length > VIRTUALIZE_ROW_LIMIT
  const windowRange = React.useMemo(() => {
    if (!virtualized) return { start: 0, end: rows.length }
    const visible = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT)
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const end = Math.min(rows.length, start + visible + OVERSCAN * 2)
    return { start, end }
  }, [virtualized, rows.length, scrollTop])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(key === 'name' || key === 'category' ? false : true)
    }
  }

  if (error) {
    return (
      <ChartCard
        title="Menu Items"
        subtitle="Item-level analytics rows"
        className={className}
        contentClassName="flex flex-col"
      >
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load menu items." />
      </ChartCard>
    )
  }

  if (loading || items === undefined) {
    return (
      <ChartCard
        title="Menu Items"
        subtitle="Item-level analytics rows"
        className={className}
        contentClassName="flex flex-col"
      >
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }

  const renderRow = (item: MenuItem, index: number) => (
    <tr
      key={item.itemId}
      className={cn('border-b border-border/60 transition-colors hover:bg-surface-strong/70', index % 2 === 1 && 'bg-surface/40')}
      style={virtualized ? { height: ROW_HEIGHT } : undefined}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <DishThumb itemId={item.itemId} name={item.name} size="lg" />
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: performanceClassColor(item.performanceClass, theme) }}
          />
          <span className="truncate text-xs font-semibold text-foreground">{item.name}</span>
        </div>
      </td>
      <td className="hidden px-3 py-2 text-xs text-muted md:table-cell">{item.category}</td>
      <td className="data-value px-3 py-2 text-right text-xs text-foreground">{formatPKR(item.price)}</td>
      <td className="data-value px-3 py-2 text-right text-xs font-semibold text-foreground">
        {formatPKR(item.revenue, { compact: true })}
      </td>
      <td className="data-value hidden px-3 py-2 text-right text-xs text-muted sm:table-cell">
        {formatInt(item.quantity)}
      </td>
      <td className="data-value px-3 py-2 text-right text-xs text-foreground">{formatPct(item.marginPct)}</td>
      <td className="data-value hidden px-3 py-2 text-right text-xs text-muted md:table-cell">
        {formatRating(item.rating)}
      </td>
      <td className="hidden px-3 py-2 text-right lg:table-cell">
        <span
          className={cn(
            'data-value inline-flex items-center gap-0.5 text-xs font-semibold',
            item.trendPct > 0 ? 'text-positive' : item.trendPct < 0 ? 'text-negative' : 'text-neutral',
          )}
        >
          {item.trendPct > 0 ? (
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          ) : item.trendPct < 0 ? (
            <ArrowDownRight className="h-3 w-3" aria-hidden />
          ) : null}
          {formatPct(item.trendPct)}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <Badge
          variant={
            item.performanceClass === 'profit_driver'
              ? 'profit-driver'
              : item.performanceClass === 'volume_driver'
                ? 'volume-driver'
                : item.performanceClass === 'hidden_opportunity'
                  ? 'hidden-opportunity'
                  : 'low-performer'
          }
        >
          {item.performanceClass.replace('_', ' ')}
        </Badge>
      </td>
    </tr>
  )

  return (
    <ChartCard
      title="Menu Items"
      subtitle={`${rows.length} of ${items.length} tracked items · sortable, searchable`}
      className={className}
      contentClassName="flex flex-col"
    >
      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items or categories…"
            aria-label="Search menu items"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-52" aria-label="Filter by performance class">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASS_FILTERS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <ChartEmpty
          message="No items match the current search or filters."
          hint="Clear the search box or pick another performance class."
        />
      ) : (
        <div
          className="-mx-1 overflow-auto rounded-xl border border-border"
          style={virtualized ? { maxHeight: VIEWPORT_HEIGHT } : { maxHeight: 560 }}
          onScroll={virtualized ? (e) => setScrollTop((e.target as HTMLDivElement).scrollTop) : undefined}
        >
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Menu items with price, revenue, quantity, margin, rating, trend and performance class
            </caption>
            <thead className="sticky top-0 z-10 bg-background-subtle/95 backdrop-blur-sm">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sortKey === col.key
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}
                      className={cn('px-3 py-2.5 font-semibold', col.className, col.numeric ? 'text-right' : 'text-left')}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider transition-colors hover:text-foreground',
                          active ? 'text-primary' : 'text-subtle',
                        )}
                      >
                        {col.label}
                        {active ? (
                          sortDesc ? (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />
                        )}
                      </button>
                    </th>
                  )
                })}
                <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-subtle">
                  Class
                </th>
              </tr>
            </thead>
            <tbody>
              {virtualized && <tr style={{ height: windowRange.start * ROW_HEIGHT }} aria-hidden />}
              {rows.slice(windowRange.start, windowRange.end).map((item, i) => renderRow(item, virtualized ? windowRange.start + i : i))}
              {virtualized && (
                <tr style={{ height: Math.max(0, (rows.length - windowRange.end) * ROW_HEIGHT) }} aria-hidden />
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
        Dot color = API performance class · values verbatim from GET /api/intelligence/menu
        {virtualized ? ' · windowed rendering (rows > 1000)' : ''}
      </p>
    </ChartCard>
  )
}
