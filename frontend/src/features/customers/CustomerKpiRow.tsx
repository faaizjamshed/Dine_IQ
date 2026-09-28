import { formatDecimal } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import type { CustomerKpis } from '@/api/types'

/** Small stat card for the customer KPI strip — values verbatim from the API. */
function CustomerStatCard({ label, value, context }: { label: string; value: string; context?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span className="data-value text-xl font-bold leading-none text-foreground">{value}</span>
      {context && <span className="text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function CustomerKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the six customer KPIs the API supplies (GET /api/intelligence/customers)
 * — no client-side aggregation. The churn bucket notes the model behind it so
 * reviewers see which numbers come from ChurnScorer.
 */
export function CustomerKpiRow({ kpis }: { kpis: CustomerKpis }) {
  return (
    <section aria-label="Customer KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <CustomerStatCard
        label="Customers with completed orders"
        value={formatInt(kpis.totalCustomers)}
        context={'Historical RFM population'}
      />
      <CustomerStatCard label="Repeat rate" value={formatPct(kpis.repeatRatePct)} context="Ordered more than once" />
      <CustomerStatCard label="New this period" value={formatInt(kpis.newCustomers)} context="First order within 30 days" />
      <CustomerStatCard label="Avg lifetime value" value={formatPKR(kpis.avgLifetimeValue, { compact: true })} context="Historical period" />
      <CustomerStatCard
        label="90+ days inactive"
        value={formatInt(kpis.highChurnRisk)}
        context={'Descriptive inactivity; at least 2 orders'}
      />
      <CustomerStatCard label="Avg orders / customer" value={formatDecimal(kpis.avgOrdersPerCustomer, 1)} context="Historical period" />
    </section>
  )
}
