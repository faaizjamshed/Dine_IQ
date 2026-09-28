import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useFilters } from '@/hooks/useFilters'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchKpis, fetchRecommendations, fetchAnomalies } from '@/api/endpoints'
import { getToken } from '@/api/client'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { KpiCard, KpiCardSkeleton } from '@/components/kpis/KpiCard'
import { RevenueTrendCard } from './sections/RevenueTrendCard'
import { ChannelMixCard } from './sections/ChannelMixCard'
import { TrafficHeatmapCard } from './sections/TrafficHeatmapCard'
import { TopBottomDishesCard } from './sections/TopBottomDishesCard'
import { CriticalRecommendations } from './sections/CriticalRecommendations'
import { AnomaliesFeed } from './sections/AnomaliesFeed'

/**
 * Executive Dashboard — the primary judging screen (spec §24).
 *
 * Composition follows the insight-first principle:
 *   Insight Strip → KPI cards → trend/channels → heatmap/rankings →
 *   critical recommendations → anomaly feed.
 *
 * Data: GET /api/overview (KPIs, trend, channel mix, heatmap, dish rankings),
 * GET /api/intelligence/recommendations?priority=critical, GET /api/intelligence/anomalies?limit=4.
 * Sections degrade independently: recommendations can fail without taking
 * the KPI grid down. No business values are computed in this page.
 */
export function DashboardPage() {
  const { filters } = useFilters()
  const navigate = useNavigate()

  const auth = { Authorization: getToken() ? `Bearer ${getToken()}` : '' }

  const kpisQuery = useQuery({
    queryKey: queryKeys.kpis(filters),
    queryFn: () => fetchKpis(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const recsQuery = useQuery({
    queryKey: queryKeys.recommendations({ ...filters, priority: 'all' }),
    queryFn: () => fetchRecommendations({ ...filters, priority: 'all' }, auth),
    staleTime: STALE_TIME.feed,
  })

  const anomaliesQuery = useQuery({
    queryKey: queryKeys.anomalies({ ...filters, limit: 4 }),
    queryFn: () => fetchAnomalies({ ...filters, limit: 4 }, auth),
    staleTime: STALE_TIME.feed,
  })

  const kpiData = kpisQuery.data?.data
  const kpiError = kpisQuery.error
  const kpiLoading = kpisQuery.isLoading

  return (
    <div className="flex flex-col gap-4">
      {/* §15 Insight Strip — renders nothing if the API supplies no insight */}
      <InsightStrip
        insight={kpisQuery.data?.insight}
        source="GET /api/overview"
        generatedAt={kpisQuery.data?.meta?.generatedAt}
        loading={kpiLoading}
      />

      {/* Scope line — mirrors the API's periodLabel for the current filters */}
      {kpiData && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] text-muted">
            Scope: {kpiData.periodLabel}
            {kpisQuery.isFetching && <span className="ml-2 text-primary">refreshing…</span>}
          </p>
          {kpisQuery.data?.meta?.note && (
            <p className="font-mono text-[10px] text-subtle">{kpisQuery.data.meta.note}</p>
          )}
        </div>
      )}

      {/* KPI grid — 8 executive cards (§24) */}
      <section aria-label="Key performance indicators">
        {kpiError ? (
          <ApiErrorState error={kpiError} retry={() => void kpisQuery.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpiLoading || !kpiData
              ? Array.from({ length: 8 }).map((_, i) => <KpiCardSkeleton key={i} />)
              : kpiData.kpis.map((kpi, i) => (
                  <KpiCard key={kpi.id} kpi={kpi} className={i >= 4 ? 'md:col-span-1' : undefined} />
                ))}
          </div>
        )}
      </section>

      {/* Trend + channel mix */}
      <div className="grid gap-4 xl:grid-cols-3">
        <RevenueTrendCard
          trend={kpiData?.revenueTrend}
          loading={kpiLoading}
          error={kpiError}
          onRetry={() => void kpisQuery.refetch()}
          className="xl:col-span-2"
        />
        <ChannelMixCard
          points={kpiData?.channelMix}
          loading={kpiLoading}
          error={kpiError}
          onRetry={() => void kpisQuery.refetch()}
        />
      </div>

      {/* Heatmap + dish rankings */}
      <div className="grid gap-4 xl:grid-cols-3">
        <TrafficHeatmapCard
          matrix={kpiData?.hourWeekday}
          loading={kpiLoading}
          error={kpiError}
          onRetry={() => void kpisQuery.refetch()}
          className="xl:col-span-2"
        />
        <TopBottomDishesCard
          dishes={kpiData?.topBottomDishes}
          loading={kpiLoading}
          error={kpiError}
          onRetry={() => void kpisQuery.refetch()}
        />
      </div>

      {/* Critical recommendations — independent query */}
      <CriticalRecommendations
        recommendations={recsQuery.data?.data.recommendations}
        loading={recsQuery.isLoading}
        error={recsQuery.error}
        onRetry={() => void recsQuery.refetch()}
        onViewAll={() => navigate('/recommendations')}
      />

      {/* Anomaly feed — independent query */}
      <AnomaliesFeed
        anomalies={anomaliesQuery.data?.data.anomalies}
        loading={anomaliesQuery.isLoading}
        error={anomaliesQuery.error}
        onRetry={() => void anomaliesQuery.refetch()}
        onViewAll={() => navigate('/anomalies')}
      />
    </div>
  )
}
