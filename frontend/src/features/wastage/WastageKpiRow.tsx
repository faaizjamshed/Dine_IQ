import { Skeleton } from '@/components/ui/skeleton'
import { formatPKR, formatPct, formatDelta } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { WastageKpis } from '@/api/types'

/** Small stat card for the wastage KPI strip — values verbatim from the API. */
function WastageStatCard({
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
      <span className={cn('data-value truncate text-xl font-bold leading-none text-foreground', valueClassName)}>
        {value}
      </span>
      {context && <span className="truncate text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function WastageKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the six wastage KPIs the API supplies (GET /api/intelligence/wastage →
 * kpis) — no client-side aggregation.
 *
 * Delta color semantics are decided by the API contract: a POSITIVE deltaPct
 * means wastage cost GREW versus the previous period, so a positive delta is
 * unfavorable and renders in rose while a negative delta (cost fell) renders
 * in positive green — favorability follows the metric's meaning, not the sign
 * convention used by revenue metrics.
 */
export function WastageKpiRow({ kpis }: { kpis: WastageKpis }) {
  const deltaTone =
    kpis.deltaPct > 0 ? 'text-negative' : kpis.deltaPct < 0 ? 'text-positive' : 'text-muted'

  return (
    <section aria-label="Wastage KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <WastageStatCard label="Wastage cost" value={formatPKR(kpis.wastageCost, { compact: true })} context="Period total" />
      <WastageStatCard label="% of revenue" value={formatPct(kpis.wastagePctOfRevenue)} context="Cost share of revenue" />
      <WastageStatCard
        label="Delta vs prev period"
        value={formatDelta(kpis.deltaPct)}
        valueClassName={deltaTone}
        context="Positive = wastage grew"
      />
      <WastageStatCard label="Over-prep share" value={formatPct(kpis.prepWasteSharePct)} context="Of wasted cost" />
      <WastageStatCard label="Spoilage share" value={formatPct(kpis.spoilageSharePct)} context="Of wasted cost" />
      {/* Worst offender — two API-supplied lines (category + outlet), no client ranking. */}
      <WastageStatCard label="Worst offender" value={kpis.worstCategory} context={kpis.worstOutlet} />
    </section>
  )
}
