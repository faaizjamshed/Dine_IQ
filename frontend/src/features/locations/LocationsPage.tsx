import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchLocationsDetail, fetchLocations } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { CityAggregates } from './CityAggregates'
import { OutletCategoryMatrix } from './OutletCategoryMatrix'
import { OutletComparisonTable } from './OutletComparisonTable'
import { LocationKpiRow, LocationKpiRowSkeleton } from './LocationKpiRow'

/**
 * Locations page (spec — Phase 4) — outlet network overview: KPI strip,
 * city aggregates, the outlet × category revenue matrix and the full outlet
 * comparison table with flags.
 *
 * Two INDEPENDENT queries react to the global URL filters and degrade
 * separately (same pattern as Menu Intelligence):
 *  - GET /api/reports/locations_menu → KPIs, city aggregates, matrix, insight.
 *  - GET /api/restaurants → per-outlet rows for the comparison table.
 * A detail failure never hides the comparison rows and vice versa.
 */
export function LocationsPage() {
  const { filters } = useFilters()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const detailQuery = useQuery({
    queryKey: queryKeys.locationsDetail(filters),
    queryFn: () => fetchLocationsDetail(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const compareQuery = useQuery({
    queryKey: queryKeys.locations(filters),
    queryFn: () => fetchLocations(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const detail = detailQuery.data?.data
  const detailError = detailQuery.error

  return (
    <div className="flex flex-col gap-4">
      {/* §15 Insight Strip — renders nothing without an API insight */}
      <InsightStrip
        insight={detailQuery.data?.insight}
        source="GET /api/reports/locations_menu"
        generatedAt={detailQuery.data?.meta?.generatedAt}
        loading={detailQuery.isLoading}
      />

      {/* Scope line — period label + mock-window note from the detail response */}
      {detail && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] text-muted">
            Scope: {detail.periodLabel}
            {detailQuery.isFetching && <span className="ml-2 text-primary">refreshing…</span>}
          </p>
          {detailQuery.data?.meta?.note && (
            <p className="font-mono text-[10px] text-subtle">{detailQuery.data.meta.note}</p>
          )}
        </div>
      )}

      {/* Location KPI strip */}
      {detailError ? (
        <ApiErrorState error={detailError} retry={() => void detailQuery.refetch()} />
      ) : detail ? (
        <LocationKpiRow kpis={detail.kpis} />
      ) : (
        <LocationKpiRowSkeleton />
      )}

      {/* City aggregates (detail query) beside the outlet comparison (compare query) */}
      <div className="grid gap-4 xl:grid-cols-2">
        <CityAggregates
          cities={detail?.cityAggregates}
          loading={detailQuery.isLoading}
          error={detailError}
          onRetry={() => void detailQuery.refetch()}
        />
        <OutletComparisonTable
          outlets={compareQuery.data?.data.outlets}
          loading={compareQuery.isLoading}
          error={compareQuery.error}
          onRetry={() => void compareQuery.refetch()}
        />
      </div>

      {/* Outlet × category matrix — full width, height scales with row count */}
      <OutletCategoryMatrix
        matrix={detail?.matrix}
        loading={detailQuery.isLoading}
        error={detailError}
        onRetry={() => void detailQuery.refetch()}
      />
    </div>
  )
}
