import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchBasketAnalysis } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { BasketKpiRow, BasketKpiRowSkeleton } from './BasketKpiRow'
import { CategoryPairFlow } from './CategoryPairFlow'
import { BasketSizeCard } from './BasketSizeCard'
import { BundleSuggestions } from './BundleSuggestions'
import { AssociationRulesTable } from './AssociationRulesTable'

/**
 * Basket & Bundles page (spec — Phase 3) — association rules, category pair
 * flow, basket-size distribution and rules-backed bundle pricing.
 *
 * Data: GET /api/intelligence/baskets (single query reacts to the global URL
 * filters and degrades to a single error state; per-section empty states
 * handle scoped-out data). Insights render only when the API supplies them.
 */
export function BasketPage() {
  const { filters } = useFilters()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const query = useQuery({
    queryKey: queryKeys.basket(filters),
    queryFn: () => fetchBasketAnalysis(filters, auth),
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
        source="GET /api/intelligence/baskets"
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
        <BasketKpiRow kpis={data.kpis} />
      ) : (
        <BasketKpiRowSkeleton />
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <CategoryPairFlow
          pairs={data?.categoryPairs}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          className="xl:col-span-2"
        />
        <BasketSizeCard
          slices={data?.basketSizeDist}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>

      <BundleSuggestions
        bundles={data?.bundles}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />

      <AssociationRulesTable
        rules={data?.rules}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    </div>
  )
}
