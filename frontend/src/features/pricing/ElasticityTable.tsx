import { formatDecimal } from '@/lib/formatters'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { ChartCard, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatPct, formatDelta } from '@/lib/formatters'
import type { ElasticityRow, PriceRecommendation } from '@/api/types'
import { cn } from '@/lib/utils'

const RECO_BADGE: Record<PriceRecommendation, string> = {
  unavailable: 'bg-surface-strong text-muted',
  raise: 'bg-positive/15 text-positive',
  test: 'bg-primary/15 text-primary',
  hold: 'bg-low/15 text-low',
  reduce: 'bg-critical/15 text-critical',
}

/**
 * Elasticity magnitude → bar color, mirroring the API engine's thresholds:
 * |e| ≥ 1.3 strongly elastic (rose), ≥ 1 elastic (amber), < 1 inelastic
 * (emerald). CSS vars keep the bar identical to the badge palette.
 */
function elasticityColor(absE: number): string {
  if (absE >= 1.3) return 'var(--negative)'
  if (absE >= 1) return 'var(--medium)'
  return 'var(--positive)'
}

type SortKey = 'elasticity' | 'currentPrice' | 'marginPct' | 'trendPct' | 'confidence'

const SORTABLE: { key: SortKey; label: string }[] = [
  { key: 'elasticity', label: 'Elasticity' },
  { key: 'currentPrice', label: 'Price' },
  { key: 'marginPct', label: 'Margin' },
  { key: 'trendPct', label: 'Pre/post units' },
  { key: 'confidence', label: 'Conf.' },
]

/**
 * Sortable header cell — three states: API order (neutral) → ascending →
 * descending → back to API order. Purely view-local; the underlying
 * API-sorted array is never mutated.
 */
function SortHeader({
  label,
  sortKey,
  active,
  asc,
  onToggle,
  className,
}: {
  label: string
  sortKey: SortKey
  active: boolean
  asc: boolean
  onToggle: (key: SortKey) => void
  className?: string
}) {
  const Icon = !active ? ArrowUpDown : asc ? ArrowUp : ArrowDown
  return (
    <th scope="col" className={cn('py-2 pr-2 font-semibold', className)}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground',
          active ? 'text-foreground' : 'text-subtle',
        )}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden />
      </button>
    </th>
  )
}

/**
 * ElasticityTable — price-elasticity scoring per item
 * (GET /api/intelligence/pricing → elasticity). The API ships rows sorted by
 * elasticity ascending (most elastic first) and that order is preserved by
 * default; column sort toggles are view-local only. Rationale strings are
 * the pricing model's own words — rendered verbatim (title shows the full
 * text when the cell truncates).
 */
export function ElasticityTable({
  rows,
  loading,
  className,
}: {
  rows?: ElasticityRow[]
  loading?: boolean
  className?: string
}) {
  const title = 'Observed Price Sensitivity'
  const subtitle = 'Item / outlet observations — uncontrolled 30-day pre/post comparison'

  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [asc, setAsc] = useState(true)

  const sorted = useMemo(() => {
    if (!rows) return []
    if (!sortKey) return rows
    return [...rows].sort((a, b) => (asc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]))
  }, [rows, sortKey, asc])

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setAsc(true)
    } else if (asc) {
      setAsc(false)
    } else {
      setSortKey(null)
      setAsc(true)
    }
  }

  if (loading || !rows) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={320} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-[480px] overflow-auto dineiq-scrollbar"
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-subtle">No elasticity rows in the API response.</p>
      ) : (
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wide text-subtle">
              <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Category</th>
              <SortHeader
                label="Price at change"
                sortKey="currentPrice"
                active={sortKey === 'currentPrice'}
                asc={asc}
                onToggle={toggleSort}
                className="text-right"
              />
              <SortHeader
                label="Elasticity"
                sortKey="elasticity"
                active={sortKey === 'elasticity'}
                asc={asc}
                onToggle={toggleSort}
                className="text-right"
              />
              <SortHeader
                label="Margin"
                sortKey="marginPct"
                active={sortKey === 'marginPct'}
                asc={asc}
                onToggle={toggleSort}
                className="text-right"
              />
              <SortHeader
                label="Pre/post units"
                sortKey="trendPct"
                active={sortKey === 'trendPct'}
                asc={asc}
                onToggle={toggleSort}
                className="text-right"
              />
              <th scope="col" className="py-2 pr-2 font-semibold">Rec.</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Observation</th>
              <SortHeader
                label="Conf."
                sortKey="confidence"
                active={sortKey === 'confidence'}
                asc={asc}
                onToggle={toggleSort}
                className="text-right"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const absE = Math.abs(r.elasticity)
              const barWidth = Math.min((absE / 2) * 100, 100)
              return (
                <tr key={r.rowId ?? r.itemId} className="border-t border-border/60 text-xs">
                  <td className="py-2 pr-2 font-medium text-foreground">{r.name}</td>
                  <td className="py-2 pr-2 text-muted">{r.category}</td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                    {formatPKR(r.currentPrice)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <span className="font-mono text-[11px] font-semibold text-foreground">
                      {formatDecimal(r.elasticity, 2)}
                    </span>
                    <span
                      aria-hidden
                      className="ml-auto mt-0.5 block h-1.5 w-14 rounded-full bg-surface-strong"
                    >
                      <span
                        className="block h-1.5 rounded-full"
                        style={{ width: `${barWidth}%`, backgroundColor: elasticityColor(absE) }}
                      />
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                    {formatPct(r.marginPct)}
                  </td>
                  <td
                    className={cn(
                      'py-2 pr-2 text-right font-mono text-[11px]',
                      r.trendPct > 0 ? 'text-positive' : r.trendPct < 0 ? 'text-negative' : 'text-muted',
                    )}
                  >
                    {formatDelta(r.trendPct)}
                  </td>
                  <td className="py-2 pr-2">
                    <span
                      className={cn(
                        'inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize',
                        RECO_BADGE[r.recommendation],
                      )}
                    >
                      {r.recommendation}
                    </span>
                  </td>
                  <td className="max-w-[260px] py-2 pr-2">
                    <span className="block truncate text-[11px] text-muted" title={r.rationale}>
                      {r.rationale}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono text-[11px] text-muted">
                    {formatDecimal(r.confidence, 2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
        Elasticity bar scales with |e| (capped at 2.0) · price recommendations are unavailable; observation text comes from the backend · local sorts are view-only
      </p>
    </ChartCard>
  )
}
