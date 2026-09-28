import { formatDecimal } from '@/lib/formatters'
import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchMenuSummary, fetchMenuItems } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { Skeleton } from '@/components/ui/skeleton'
import { PopularityMarginScatter } from './PopularityMarginScatter'
import { ClassDistributionCard } from './ClassDistributionCard'
import { TrickyCasesGrid } from './TrickyCasesGrid'
import { MenuItemsTable } from './MenuItemsTable'
import type { MenuKpis } from '@/api/types'

/** Small stat card for the menu KPI strip — values verbatim from the API. */
function MenuStatCard({ label, value, context }: { label: string; value: string; context?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span className="data-value text-xl font-bold leading-none text-foreground">{value}</span>
      {context && <span className="text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

function MenuKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/** Renders the six menu KPIs the API supplies — no client-side aggregation. */
function MenuKpiRow({ kpis, watchlistCount }: { kpis: MenuKpis; watchlistCount: number }) {
  return (
    <section aria-label="Menu KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <MenuStatCard
        label="Items tracked"
        value={formatDecimal(kpis.itemsTracked, 0)}
        context={`${Math.round(kpis.revenueCoverage * 100)}% of national revenue`}
      />
      <MenuStatCard label="Weighted margin" value={formatDecimal(kpis.avgMarginPct) + '%'} context="Across tracked items" />
      <MenuStatCard label="Mean rating" value={formatDecimal(kpis.avgRating)} context="Across tracked items" />
      <MenuStatCard
        label="Promo-dependent"
        value={formatDecimal(kpis.promoDependentItems, 0)}
        context="> 50% promo-driven volume"
      />
      <MenuStatCard label="Waste / estimated cost" value={formatDecimal(kpis.wastagePct) + '%'} context="Cost ratio, not units wasted" />
      <MenuStatCard
        label="Watchlist cases"
        value="Unavailable"
        context="Backend-flagged, see below"
      />
    </section>
  )
}

/**
 * Menu Intelligence page (spec §25) — popularity × margin quadrants,
 * performance-class distribution, the tricky-case watchlist and the full
 * item table.
 *
 * Data: GET /api/intelligence/menu (KPIs, scatter, distribution, tricky cases,
 * insight) + GET /api/intelligence/menu (table rows). Both queries react to the
 * global URL filters and degrade independently.
 */
export function MenuPage() {
  const { filters } = useFilters()
  const auth = { Authorization: getToken() ? `Bearer ${getToken()}` : '' }

  const summaryQuery = useQuery({
    queryKey: queryKeys.menuSummary(filters),
    queryFn: () => fetchMenuSummary(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const itemsQuery = useQuery({
    queryKey: queryKeys.menuItems(filters),
    queryFn: () => fetchMenuItems(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const summary = summaryQuery.data?.data
  const summaryError = summaryQuery.error

  return (
    <div className="flex flex-col gap-4">
      {/* §15 Insight Strip — renders nothing without an API insight */}
      <InsightStrip
        insight={summaryQuery.data?.insight}
        source="GET /api/intelligence/menu"
        generatedAt={summaryQuery.data?.meta?.generatedAt}
        loading={summaryQuery.isLoading}
      />

      {/* Scope line */}
      {summary && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] text-muted">
            Scope: {summary.periodLabel}
            {summaryQuery.isFetching && <span className="ml-2 text-primary">refreshing…</span>}
          </p>
          {summaryQuery.data?.meta?.note && (
            <p className="font-mono text-[10px] text-subtle">{summaryQuery.data.meta.note}</p>
          )}
        </div>
      )}

      {/* Menu KPI strip */}
      {summaryError ? (
        <ApiErrorState error={summaryError} retry={() => void summaryQuery.refetch()} />
      ) : summary ? (
        <MenuKpiRow kpis={summary.kpis} watchlistCount={summary.trickyCases.length} />
      ) : (
        <MenuKpiRowSkeleton />
      )}

      {/* Quadrant scatter + class distribution */}
      <div className="grid gap-4 xl:grid-cols-3">
        <PopularityMarginScatter
          scatter={summary?.scatter}
          loading={summaryQuery.isLoading}
          error={summaryError}
          onRetry={() => void summaryQuery.refetch()}
          className="xl:col-span-2"
        />
        <ClassDistributionCard
          slices={summary?.classDistribution}
          loading={summaryQuery.isLoading}
          error={summaryError}
          onRetry={() => void summaryQuery.refetch()}
        />
      </div>

      {/* Tricky cases — backend-flagged watchlist */}
      <TrickyCasesGrid cases={summary?.trickyCases} loading={summaryQuery.isLoading} />

      {/* Full item table — independent query so a summary failure doesn't hide rows */}
      <MenuItemsTable
        items={itemsQuery.data?.data.items}
        loading={itemsQuery.isLoading}
        error={itemsQuery.error}
        onRetry={() => void itemsQuery.refetch()}
      />
    </div>
  )
}
