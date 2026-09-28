import { Skeleton } from '@/components/ui/skeleton'
import { formatInt, formatPct } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { LocationsDetailData } from '@/api/types'

type LocationKpis = LocationsDetailData['kpis']

/** Small stat card for the locations KPI strip — values verbatim from the API. */
function LocationStatCard({
  label,
  value,
  context,
  valueClassName,
}: {
  label: string
  value: string
  context?: string
  valueClassName?: string
}) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span
        className={cn(
          'data-value truncate text-xl font-bold leading-none text-foreground',
          valueClassName,
        )}
      >
        {value}
      </span>
      {context && <span className="truncate text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function LocationKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the five location KPIs the API supplies
 * (GET /api/reports/locations_menu → data.kpis) — no client-side aggregation.
 * The Flagged Outlets card only picks up a rose accent when the API count is
 * above zero; zero means nothing is flagged and the value stays neutral.
 */
export function LocationKpiRow({ kpis }: { kpis: LocationKpis }) {
  const flagged = kpis.flaggedOutlets > 0
  return (
    <section aria-label="Location KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <LocationStatCard label="Outlets" value={formatInt(kpis.outlets)} context="In current scope" />
      <LocationStatCard label="Cities" value={formatInt(kpis.cities)} context="Network footprint" />
      <LocationStatCard label="Best outlet" value={kpis.bestOutlet} />
      <LocationStatCard
        label="Flagged outlets"
        value={formatInt(kpis.flaggedOutlets)}
        context={flagged ? 'Carrying performance flags' : 'Nothing flagged'}
        valueClassName={flagged ? 'text-negative' : undefined}
      />
      <LocationStatCard
        label="Avg contribution margin"
        value={formatPct(kpis.avgMarginPct)}
        context="Across scoped outlets"
      />
    </section>
  )
}
