import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchModelComparison } from '@/api/endpoints'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { PipelineKpiRow, PipelineKpiRowSkeleton } from './PipelineKpiRow'
import { MetricsComparison } from './MetricsComparison'
import { AgreementTable } from './AgreementTable'
import { RecordDiffTable } from './RecordDiffTable'
import { PipelineRunsTable } from './PipelineRunsTable'

/**
 * Model Comparison page (spec — Phase 5) — the Spark vs Python parity audit:
 * headline agreement KPIs, per-metric engine comparison, output agreement
 * per aggregation contract, record-level diff samples and recent run
 * history.
 *
 * Data: GET /api/ml/demand-comparison — a GLOBAL parity audit, so this query
 * intentionally takes NO filters (unlike scoped pages) and its cache key is
 * filter-free. Errors degrade per-section like every other module.
 */
export function ModelsPage() {
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const query = useQuery({
    queryKey: queryKeys.pipelines(),
    queryFn: () => fetchModelComparison(auth),
    staleTime: STALE_TIME.kpis,
  })

  const data = query.data?.data
  const meta = query.data?.meta

  return (
    <div className="flex flex-col gap-4">
      <InsightStrip
        insight={query.data?.insight}
        source="GET /api/ml/demand-comparison"
        generatedAt={meta?.generatedAt}
        loading={query.isLoading}
      />

      {/* Parity-audit explanation supplied by the API — rendered verbatim. */}
      {data && meta?.note && (
        <p className="font-mono text-[11px] leading-relaxed text-muted">{meta.note}</p>
      )}

      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <PipelineKpiRow kpis={data.kpis} />
      ) : (
        <PipelineKpiRowSkeleton />
      )}

      <MetricsComparison
        metrics={data?.metrics}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <AgreementTable
          rows={data?.agreement}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <RecordDiffTable
          rows={data?.recordDiffSample}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>

      <PipelineRunsTable
        runs={data?.recentRuns}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    </div>
  )
}
