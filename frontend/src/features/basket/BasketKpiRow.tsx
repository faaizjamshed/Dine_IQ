import { formatDecimal } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import type { BasketKpis } from '@/api/types'

/** Small stat card for the basket KPI strip — values verbatim from the API. */
function BasketStatCard({ label, value, context }: { label: string; value: string; context?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span className="data-value text-xl font-bold leading-none text-foreground">{value}</span>
      {context && <span className="text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function BasketKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the six basket KPIs the API supplies (GET /api/intelligence/baskets →
 * kpis) — no client-side aggregation. The strong-rules context surfaces the
 * backend's own lift/support thresholds so the count is interpretable, and
 * the bundle-opportunity count mirrors the `bundles` payload length upstream.
 */
export function BasketKpiRow({ kpis }: { kpis: BasketKpis }) {
  return (
    <section aria-label="Basket KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <BasketStatCard label="Baskets analyzed" value={formatInt(kpis.basketsAnalyzed)} context="Complete orders in scope" />
      <BasketStatCard label="Avg basket size" value={`${formatDecimal(kpis.avgBasketSize, 2)} items`} context="Line items per order" />
      <BasketStatCard label="Avg basket value" value={formatPKR(kpis.avgBasketValue)} context="Per completed order" />
      <BasketStatCard label="Attach rate" value={formatPct(kpis.attachRatePct)} context="Orders with an add-on" />
      <BasketStatCard label="Supported rules returned" value={formatInt(kpis.strongRules)} context="confidence ≥ 10% · lift > 1" />
      <BasketStatCard label="Bundle opportunities" value={formatInt(kpis.bundleOpportunities)} context="Rules-backed bundles" />
    </section>
  )
}
