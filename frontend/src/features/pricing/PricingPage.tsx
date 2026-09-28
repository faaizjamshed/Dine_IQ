import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchPricingOverview } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ApiErrorState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PricingKpiRow, PricingKpiRowSkeleton } from './PricingKpiRow'
import { ElasticityTable } from './ElasticityTable'
import { PromoKpiRow, PromoKpiRowSkeleton } from './PromoKpiRow'
import { CampaignTable } from './CampaignTable'
import { PromoTrapCards } from './PromoTrapCards'

type PageTab = 'pricing' | 'promotions'

/**
 * Pricing & Promotions page (spec — Phase 4) — price-elasticity scoring and
 * the promotion effectiveness ledger, split across two tabs.
 *
 * The active tab persists in the URL (?tab=pricing|promotions) following the
 * page-level param pattern used by the recommendations page; `pricing` is
 * the default and is deliberately NOT written to the URL (defaults stay
 * clean, matching the global filter convention).
 *
 * Data: GET /api/intelligence/pricing — a SINGLE shared query for both tabs, so
 * switching tabs only re-renders (Radix unmounts the inactive pane) and
 * never refetches.
 */
export function PricingPage() {
  const { filters } = useFilters()
  const [searchParams, setSearchParams] = useSearchParams()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const tab: PageTab = searchParams.get('tab') === 'promotions' ? 'promotions' : 'pricing'

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'pricing') next.delete('tab')
    else next.set('tab', value)
    setSearchParams(next, { replace: false })
  }

  const query = useQuery({
    queryKey: queryKeys.pricing(filters),
    queryFn: () => fetchPricingOverview(filters, auth),
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
        source="GET /api/intelligence/pricing"
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Pricing and promotions views">
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="promotions">Promotions</TabsTrigger>
        </TabsList>

        {/* Pricing pane — elasticity scoring (same shared query, no refetch on switch) */}
        <TabsContent value="pricing" className="mt-4 flex flex-col gap-4">
          {query.error ? (
            <ApiErrorState error={query.error} retry={() => void query.refetch()} />
          ) : data ? (
            <PricingKpiRow kpis={data.pricingKpis} />
          ) : (
            <PricingKpiRowSkeleton />
          )}

          <ElasticityTable rows={data?.elasticity} loading={query.isLoading} />
        </TabsContent>

        {/* Promotions pane — campaigns + promo traps (same shared query) */}
        <TabsContent value="promotions" className="mt-4 flex flex-col gap-4">
          {query.error ? (
            <ApiErrorState error={query.error} retry={() => void query.refetch()} />
          ) : data ? (
            <PromoKpiRow kpis={data.promoKpis} totalCampaigns={data.campaigns.length} />
          ) : (
            <PromoKpiRowSkeleton />
          )}

          <CampaignTable campaigns={data?.campaigns} loading={query.isLoading} />

          <PromoTrapCards traps={data?.promoTraps} loading={query.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
