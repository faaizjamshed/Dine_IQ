import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchAdminOverview } from '@/api/endpoints'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { AdminKpiRow, AdminKpiRowSkeleton } from './AdminKpiRow'
import { SparkJobsTable } from './SparkJobsTable'
import { DataQualityList } from './DataQualityList'
import { ModelRegistryTable } from './ModelRegistryTable'
import { AuditTrailTable } from './AuditTrailTable'

/**
 * Admin page (spec — Phase 5) — the platform operations command centre:
 * ingestion KPIs, the Spark job monitor, data-quality checks, the model
 * registry and the audit trail.
 *
 * Access: this module is ROUTE-GUARDED by the admin.access permission at the
 * router level (RoleGuard on /admin) — no in-page guard is rendered here.
 *
 * Data: GET /api/system/evidence — a global platform payload, so the query
 * intentionally takes NO filters; errors degrade per-section like every
 * other module.
 */
export function AdminPage() {
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const query = useQuery({
    queryKey: queryKeys.admin(),
    queryFn: () => fetchAdminOverview(auth),
    staleTime: STALE_TIME.kpis,
  })

  const data = query.data?.data
  const meta = query.data?.meta

  return (
    <div className="flex flex-col gap-4">
      <InsightStrip
        insight={query.data?.insight}
        source="GET /api/system/evidence"
        generatedAt={meta?.generatedAt}
        loading={query.isLoading}
      />

      {/* Platform operations note supplied by the API — rendered verbatim. */}
      {data && meta?.note && (
        <p className="font-mono text-[11px] leading-relaxed text-muted">{meta.note}</p>
      )}

      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <AdminKpiRow kpis={data.kpis} />
      ) : (
        <AdminKpiRowSkeleton />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <SparkJobsTable
          jobs={data?.sparkJobs}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <DataQualityList
          checks={data?.dataQuality}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelRegistryTable
          models={data?.modelRegistry}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <AuditTrailTable
          events={data?.auditTrail}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    </div>
  )
}
