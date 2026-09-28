import { ChartCard, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { Badge } from '@/components/ui/badge'
import { DishThumb } from '@/components/ui/dish-thumb'
import { EvidenceList } from '@/components/insights/EvidenceList'
import { humanize } from '@/lib/formatters'
import type { MenuCase } from '@/api/types'

const SEVERITY_VARIANT = {
  high: 'high',
  medium: 'medium',
  low: 'low',
} as const

/**
 * TrickyCasesGrid — the backend's watchlist of tricky menu cases (spec §25):
 * promo dependency, high wastage, rating risk, fading stars and margin
 * outliers. Headlines, details and evidence are rendered VERBATIM from
 * GET /api/intelligence/menu → data.trickyCases — the frontend never derives a
 * case or its narrative.
 */
export function TrickyCasesGrid({
  cases,
  loading,
  className,
}: {
  cases?: MenuCase[]
  loading?: boolean
  className?: string
}) {
  if (loading || cases === undefined) {
    return (
      <ChartCard title="Tricky Menu Cases" subtitle="Backend-flagged watchlist" className={className}>
        <ChartSkeleton height={200} />
      </ChartCard>
    )
  }

  if (cases.length === 0) {
    return (
      <ChartCard title="Tricky Menu Cases" subtitle="Backend-flagged watchlist" className={className}>
        <ChartEmpty message="A separate menu watchlist is unavailable from the existing backend." hint="Every threshold rule is clear in the current scope." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="Tricky Menu Cases"
      subtitle={`Backend-flagged watchlist · ${cases.length} case${cases.length === 1 ? '' : 's'}`}
      className={className}
      contentClassName="flex flex-col"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cases.map((c) => (
          <article
            key={c.id}
            className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-strong/60 p-3.5 transition-colors hover:border-border-strong"
          >
            <div className="flex flex-wrap items-center gap-2">
              {c.itemName && <DishThumb itemId={c.itemId} name={c.itemName} size="md" />}
              <Badge variant={SEVERITY_VARIANT[c.severity]}>{c.severity}</Badge>
              <Badge variant="outline">{humanize(c.caseType)}</Badge>
              {c.itemName && <span className="truncate text-xs font-medium text-muted">{c.itemName}</span>}
            </div>

            <p className="text-sm font-semibold leading-snug text-foreground">{c.headline}</p>
            <p className="text-xs leading-relaxed text-muted">{c.detail}</p>

            <div className="mt-auto border-t border-border pt-2">
              <EvidenceList evidence={c.evidence} />
            </div>
          </article>
        ))}
      </div>
    </ChartCard>
  )
}
