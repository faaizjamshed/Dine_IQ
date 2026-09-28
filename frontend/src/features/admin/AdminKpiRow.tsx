import { formatDecimal } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { formatInt, formatNumberCompact } from '@/lib/formatters'
import type { AdminOverviewData } from '@/api/types'

type AdminKpis = AdminOverviewData['kpis']

/** Small stat card for the admin KPI strip — mirrors the shared KPI card language; `accent` tints the value. */
function AdminStatCard({
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
      <span className={`data-value text-xl font-bold leading-none ${accent ?? 'text-foreground'}`}>
        {value}
      </span>
      {context && <span className="text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function AdminKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * AdminKpiRow — the six platform-operations KPIs from
 * GET /api/system/evidence → kpis (tablesIngested, rowsIngested,
 * runsLast24h, failedJobs, storageGb, openQualityFails). Failed jobs and
 * open quality fails turn rose (critical) when > 0 so an unhealthy platform
 * reads at a glance; values come straight from the API — no aggregation.
 */
export function AdminKpiRow({ kpis }: { kpis: AdminKpis }) {
  return (
    <section
      aria-label="Platform operations KPIs"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <AdminStatCard label="Tables ingested" value={formatInt(kpis.tablesIngested)} context="Curated warehouse tables" />
      <AdminStatCard
        label="Rows ingested"
        value={formatNumberCompact(kpis.rowsIngested)}
        context={`${formatInt(kpis.rowsIngested)} rows total`}
      />
      <AdminStatCard label="Runs (24h)" value={formatInt(kpis.runsLast24h)} context="Ingestion + quality cycles" />
      <AdminStatCard
        label="Failed jobs"
        value={formatInt(kpis.failedJobs)}
        context="Last 24 hours"
        accent={kpis.failedJobs > 0 ? 'text-critical' : undefined}
      />
      <AdminStatCard label="Storage" value={`${formatDecimal(kpis.storageGb, 1)} GB`} context="Warehouse footprint" />
      <AdminStatCard
        label="Open quality fails"
        value={formatInt(kpis.openQualityFails)}
        context="Checks currently failing"
        accent={kpis.openQualityFails > 0 ? 'text-critical' : undefined}
      />
    </section>
  )
}
