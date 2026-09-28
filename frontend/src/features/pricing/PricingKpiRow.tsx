import { formatDecimal } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPKR, formatInt } from '@/lib/formatters'
import type { PricingKpis } from '@/api/types'

/** Small stat card shared by the pricing KPI strip — values verbatim from the API. */
function PricingStatCard({ label, value, context }: { label: string; value: string; context?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span className="data-value text-xl font-bold leading-none text-foreground">{value}</span>
      {context && <span className="truncate text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function PricingKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the six pricing KPIs the API supplies
 * (GET /api/intelligence/pricing → pricingKpis) — no client-side aggregation.
 * Elasticity sign convention is the pricing model's (negative = demand falls
 * as price rises); the interpretation hints in each context line repeat the
 * thresholds the API's recommendation engine uses.
 */
export function PricingKpiRow({ kpis }: { kpis: PricingKpis }) {
  return (
    <section aria-label="Pricing KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <PricingStatCard label="Items analyzed" value={formatInt(kpis.itemsAnalyzed)} context="Scored by ElasticityModel" />
      <PricingStatCard
        label="Avg elasticity"
        value={formatDecimal(kpis.avgElasticity, 1)}
        context="|e| < 1 = inelastic"
      />
      <PricingStatCard
        label="Inelastic items"
        value={formatInt(kpis.inelasticItems)}
        context="Safe zone for increases"
      />
      <PricingStatCard
        label="Elastic items"
        value={formatInt(kpis.elasticItems)}
        context="Price moves shift demand"
      />
      <PricingStatCard
        label="A/B test candidates"
        value={formatInt(kpis.testCandidates)}
        context="Test before national moves"
      />
      <PricingStatCard
        label="Revenue at stake"
        value={formatPKR(kpis.revenueAtStake, { compact: true })}
        context="Touches a pricing lever"
      />
    </section>
  )
}
