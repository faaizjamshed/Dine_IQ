import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { DishThumb } from '@/components/ui/dish-thumb'
import { formatPKR } from '@/lib/formatters'
import type { BundleSuggestion } from '@/api/types'

/**
 * BundleSuggestions — rules-backed bundle pricing cards
 * (GET /api/intelligence/baskets → bundles). Item prices, the combined price and
 * the suggested price are API values rendered verbatim; the only client-side
 * arithmetic is the "save" figure (combinedPrice − suggestedPrice), which is
 * presentational formatting of two supplied numbers, NOT a computed business
 * metric. `basis` renders verbatim in small text — never edited or extended.
 */
export function BundleSuggestions({
  bundles,
  loading,
  error,
  onRetry,
  className,
}: {
  bundles?: BundleSuggestion[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Bundle Opportunities'
  const subtitle = 'Rules-backed bundles priced from observed pair frequency'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load bundle suggestions." />
      </ChartCard>
    )
  }
  if (loading || !bundles) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={240} />
      </ChartCard>
    )
  }
  if (bundles.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="Priced bundle suggestions are unavailable. See real cross-sell rules below." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="grid content-start gap-3 md:grid-cols-2"
      actions={<span className="font-mono text-[10px] text-subtle">{bundles.length} bundles</span>}
    >
      {bundles.map((b) => (
        <article key={b.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-strong/40 p-4">
          <ul className="flex flex-col gap-1.5" aria-label={`Items in bundle ${b.id}`}>
            {b.items.map((it) => (
              <li key={it.itemId} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <DishThumb itemId={it.itemId} name={it.name} size="sm" />
                  <span className="truncate font-medium text-foreground">{it.name}</span>
                </span>
                <span className="font-mono text-[11px] text-muted">{formatPKR(it.price)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-end justify-between gap-3 border-t border-border pt-2.5">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wide text-subtle">Suggested</span>
              <span className="data-value text-lg font-bold leading-tight text-foreground">
                {formatPKR(b.suggestedPrice)}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-[11px] text-subtle line-through">{formatPKR(b.combinedPrice)}</span>
              <span className="rounded-md bg-positive/15 px-1.5 py-0.5 text-[10px] font-bold text-positive">
                Save {formatPKR(b.combinedPrice - b.suggestedPrice)}
              </span>
            </div>
          </div>
          <p className="text-[11px] leading-snug text-subtle">{b.basis}</p>
        </article>
      ))}
    </ChartCard>
  )
}
