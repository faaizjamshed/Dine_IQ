import { Skeleton } from '@/components/ui/skeleton'
import { formatPct, formatInt } from '@/lib/formatters'
import type { PromoKpis } from '@/api/types'

/** Small stat card shared by the promotions KPI strip — values verbatim from the API. */
function PromoStatCard({
  label,
  value,
  context,
  accent,
}: {
  label: string
  value: string
  context?: string
  accent?: string
}) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span
        className={`data-value text-xl font-bold leading-none ${accent ?? 'text-foreground'}`}
      >
        {value}
      </span>
      {context && <span className="truncate text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function PromoKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the five promotion KPIs the API supplies
 * (GET /api/intelligence/pricing → promoKpis) — no client-side aggregation.
 * `totalCampaigns` comes from the campaigns array in the same response so
 * the positive-ROI context line reflects the full list, not a recomputation.
 */
export function PromoKpiRow({ kpis, totalCampaigns }: { kpis: PromoKpis; totalCampaigns: number }) {
  return (
    <section aria-label="Promotion KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <PromoStatCard label="Active campaigns" value={formatInt(kpis.activeCampaigns)} context={`${totalCampaigns} in window`} />
      <PromoStatCard
        label="Revenue on promotion"
        value={formatPct(kpis.revenueOnPromoPct)}
        context="Share of period revenue"
      />
      <PromoStatCard label="Avg discount" value={formatPct(kpis.avgDiscountPct)} context="Across campaigns" />
      <PromoStatCard
        label="Positive-ROI campaigns"
        value={formatInt(kpis.positiveRoiCampaigns)}
        context={`of ${formatInt(totalCampaigns)} total`}
      />
      <PromoStatCard
        label="Trapped items"
        value={formatInt(kpis.trappedItems)}
        context="Structural discount dependency"
        accent="text-negative"
      />
    </section>
  )
}
