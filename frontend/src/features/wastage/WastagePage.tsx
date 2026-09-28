import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchWastageOverview } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { WastageKpiRow, WastageKpiRowSkeleton } from './WastageKpiRow'
import { WastageTrendCard } from './WastageTrendCard'
import { WastageByCategory } from './WastageByCategory'
import { WastageOutletsTable } from './WastageOutletsTable'
import { WastageItemsTable } from './WastageItemsTable'

/**
 * Wastage Analytics page (spec — Phase 3) — wastage cost trend, category
 * breakdown, outlet comparison (with API abnormal flags) and item-level
 * wastage.
 *
 * Data: GET /api/intelligence/wastage (single query reacts to the global URL
 * filters and degrades to a single error state; per-section empty states
 * handle scoped-out data). Insights render only when the API supplies them.
 */
export function WastagePage() {
  const { filters } = useFilters()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const query = useQuery({
    queryKey: queryKeys.wastage(filters),
    queryFn: () => fetchWastageOverview(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const data = query.data?.data
  const meta = query.data?.meta
  const model =
    meta?.modelName && meta?.modelVersion && meta?.generatedAt && meta?.pipeline
      ? { name: meta.modelName, version: meta.modelVersion, generatedAt: meta.generatedAt, pipeline: meta.pipeline }
      : undefined

  return (
    <div className="flex flex-col gap-4">
      <InsightStrip
        insight={query.data?.insight}
        source="GET /api/intelligence/wastage"
        generatedAt={meta?.generatedAt}
        loading={query.isLoading}
      />

      {data && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] text-muted">
            Scope: {data.periodLabel}
            {meta?.note && <span className="ml-2 text-subtle">{meta.note}</span>}
            {query.isFetching && <span className="ml-2 text-primary">refreshing…</span>}
          </p>
          <ModelMetadata model={model} dense />
        </div>
      )}

      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <WastageKpiRow kpis={data.kpis} />
      ) : (
        <WastageKpiRowSkeleton />
      )}

      <WastageTrendCard
        trend={data?.trend}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <WastageByCategory
          rows={data?.byCategory}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <WastageOutletsTable
          rows={data?.byOutlet}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>

      <WastageItemsTable
        rows={data?.byItem}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    </div>
  )
}
