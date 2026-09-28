import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchCustomersOverview } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { CustomerKpiRow, CustomerKpiRowSkeleton } from './CustomerKpiRow'
import { SegmentOverview } from './SegmentOverview'
import { RfmTierTable, ChurnRiskBuckets } from './RfmTierTable'
import { CohortRetentionCard } from './CohortRetentionCard'
import { PromoSensitivityCard, TopCustomersTable } from './PromoSensitivityCard'

/**
 * Customer Intelligence page (spec — Phase 3) — segments, RFM tiers, churn
 * risk buckets, monthly cohort retention, promo sensitivity and the win-back
 * shortlist.
 *
 * Data: GET /api/intelligence/customers (single query reacts to the global URL
 * filters and degrades to a single error state; per-section empty states
 * handle scoped-out data).
 */
export function CustomersPage() {
  const { filters } = useFilters()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const query = useQuery({
    queryKey: queryKeys.customers(filters),
    queryFn: () => fetchCustomersOverview(filters, auth),
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
      {meta?.note && <p className="text-xs leading-relaxed text-muted">{meta.note}</p>}
      <InsightStrip
        insight={query.data?.insight}
        source="GET /api/intelligence/customers"
        generatedAt={meta?.generatedAt}
        loading={query.isLoading}
      />

      {data && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] text-muted">
            Scope: {data.periodLabel}
            {query.isFetching && <span className="ml-2 text-primary">refreshing…</span>}
          </p>
          <ModelMetadata model={model} dense />
        </div>
      )}

      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <CustomerKpiRow kpis={data.kpis} />
      ) : (
        <CustomerKpiRowSkeleton />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <SegmentOverview
          segments={data?.segments}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <RfmTierTable
          tiers={data?.rfmTiers}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>

      <ChurnRiskBuckets buckets={data?.churnRisk} loading={query.isLoading} />

      <div className="grid gap-4 xl:grid-cols-2">
        <CohortRetentionCard
          cohorts={data?.cohortRetention}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <div className="flex flex-col gap-4">
      {meta?.note && <p className="text-xs leading-relaxed text-muted">{meta.note}</p>}
          <PromoSensitivityCard
            rows={data?.promoSensitivity}
            loading={query.isLoading}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          <TopCustomersTable customers={data?.topCustomers} loading={query.isLoading} />
        </div>
      </div>
    </div>
  )
}
