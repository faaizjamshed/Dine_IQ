import { formatDecimal } from '@/lib/formatters'
import * as React from 'react'
import { ArrowRight } from 'lucide-react'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { DishThumb } from '@/components/ui/dish-thumb'
import { formatInt, formatPct, humanize } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { AssociationRule, RuleOpportunity } from '@/api/types'

/**
 * Opportunity badge tints — theme-wired tokens so badges track the active
 * theme: bundle_candidate emerald, cross_sell sky, menu_placement violet,
 * none neutral slate.
 */
const OPPORTUNITY_BADGE: Record<RuleOpportunity, string> = {
  bundle_candidate: 'bg-positive/15 text-positive',
  cross_sell: 'bg-volume-driver/15 text-volume-driver',
  menu_placement: 'bg-hidden-opportunity/15 text-hidden-opportunity',
  none: 'bg-low/15 text-low',
}

type SortKey = 'rank' | 'lift' | 'support' | 'confidence'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rank', label: 'Rank' },
  { key: 'lift', label: 'Lift' },
  { key: 'support', label: 'Support' },
  { key: 'confidence', label: 'Confidence' },
]

/**
 * AssociationRulesTable — the backend's ranked association rules
 * (GET /api/intelligence/baskets → rules). Rows render in API order by default and
 * are never re-ranked client-side; the lift/support/confidence toggles are a
 * local view affordance only. `estimatedImpact` renders only when the API
 * ships it, verbatim ("{metric} {estimate}").
 */
export function AssociationRulesTable({
  rules,
  loading,
  error,
  onRetry,
  className,
}: {
  rules?: AssociationRule[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const [sort, setSort] = React.useState<SortKey>('rank')
  const title = 'Association Rules'
  const subtitle = 'Antecedent → consequent pairs · ordered by the backend, never re-ranked'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load association rules." />
      </ChartCard>
    )
  }
  if (loading || !rules) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }
  if (rules.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No association rules for the selected filters." />
      </ChartCard>
    )
  }

  // Presentation-only re-sort; the default view preserves the API ranking.
  const metric = (r: AssociationRule): number =>
    sort === 'lift' ? r.lift : sort === 'support' ? r.supportPct : r.confidencePct
  const view = sort === 'rank' ? rules : [...rules].sort((a, b) => metric(b) - metric(a))

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-y-auto dineiq-scrollbar"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-[10px] text-subtle">
            {rules.length} rules · {sort === 'rank' ? 'backend-ranked' : `sorted by ${sort}`}
          </span>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Sort rules">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={cn(
                  'rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors',
                  sort === s.key
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-border text-muted hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Rule</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Category</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Support</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Confidence</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Lift</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Orders</th>
            <th scope="col" className="py-2 text-right font-semibold">Opportunity</th>
          </tr>
        </thead>
        <tbody>
          {view.map((r) => (
            <tr key={r.id} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2">
                <div className="flex items-center gap-1.5">
                  <DishThumb itemId={r.antecedent.itemId} name={r.antecedent.name} size="xs" />
                  <span className="font-medium text-foreground">{r.antecedent.name}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
                  <DishThumb itemId={r.consequent.itemId} name={r.consequent.name} size="xs" />
                  <span className="font-medium text-foreground">{r.consequent.name}</span>
                </div>
                {r.estimatedImpact && (
                  <p className="mt-0.5 text-[10px] text-subtle">
                    {r.estimatedImpact.metric} {r.estimatedImpact.estimate}
                  </p>
                )}
              </td>
              <td className="py-2 pr-2 text-muted">{r.category}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{formatPct(r.supportPct)}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{formatPct(r.confidencePct, 0)}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] font-bold text-foreground">{formatDecimal(r.lift, 1)}×</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{formatInt(r.pairOrders)}</td>
              <td className="py-2 text-right">
                <span
                  className={cn(
                    'inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                    OPPORTUNITY_BADGE[r.opportunity],
                  )}
                >
                  {humanize(r.opportunity)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
