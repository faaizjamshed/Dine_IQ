import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchForecastOverview } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { ForecastKpiRow, ForecastKpiRowSkeleton } from './ForecastKpiRow'
import { ForecastChart } from './ForecastChart'
import { AccuracyTable } from './AccuracyTable'
import { ForecastItemsTable } from './ForecastItemsTable'
import { HourlyPrediction } from './HourlyPrediction'
import { DailyOutlook } from './DailyOutlook'

/**
 * Demand Forecast page (spec — Phase 3) — the DemandForecaster command view:
 * 14-day orders/revenue estimates with a 90% confidence band, backtest
 * accuracy across pipelines, and per-item 7-day outlook.
 *
 * DATA-INTEGRITY: every number on this page is a MODEL ESTIMATE produced by
 * the forecasting pipeline, not an observed actual. ModelMetadata (from the
 * response meta) sits next to the scope line so that attribution is visible
 * before any number is read.
 *
 * Data: GET /api/ml/demand-comparison (single query reacts to the global URL
 * filters and degrades to a single error state; per-section empty states
 * handle scoped-out data).
 */
export function ForecastPage() {
  const { filters } = useFilters()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const query = useQuery({
    queryKey: queryKeys.forecast(filters),
    queryFn: () => fetchForecastOverview(filters, auth),
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
        source="GET /api/ml/demand-comparison"
        generatedAt={meta?.generatedAt}
        loading={query.isLoading}
      />

      {data && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] text-muted">
            Scope: {data.periodLabel}
            {meta?.note ? ` · ${meta.note}` : ''}
            {query.isFetching && <span className="ml-2 text-primary">refreshing…</span>}
          </p>
          <ModelMetadata model={model} dense />
        </div>
      )}

      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <ForecastKpiRow kpis={data.kpis} meta={meta} />
      ) : (
        <ForecastKpiRowSkeleton />
      )}

      <HourlyPrediction />
      <DailyOutlook />
      <ForecastChart
        daily={data?.daily}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <AccuracyTable rows={data?.accuracy} loading={query.isLoading} />
        <ForecastItemsTable items={data?.items} loading={query.isLoading} className="xl:col-span-2" />
      </div>
    </div>
  )
}
