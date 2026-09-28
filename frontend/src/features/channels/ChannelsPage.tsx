import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchChannels, fetchChannelsHourly } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { ChannelCards } from './ChannelCards'
import { ChannelHourlyHeatmap } from './ChannelHourlyHeatmap'
import { ChannelEconomicsTable } from './ChannelEconomicsTable'

/**
 * Channels page (spec — Phase 4) — channel economics: per-channel cards, the
 * channel × hour order heatmap and the full comparison table.
 *
 * Integrity: NEITHER endpoint supplies an insight (GET /api/channels
 * and GET /api/channels/hourly both ship data + meta only), so there is no
 * InsightStrip on this page — the frontend never fabricates interpretation
 * (spec §15). The meta note from the hourly response ("each channel row sums
 * to its 30-day order total") stands in as the scope/reconciliation line.
 *
 * Two INDEPENDENT queries react to the global URL filters and degrade
 * separately:
 *  - GET /api/channels → channel cards + economics table.
 *  - GET /api/channels/hourly → channel × hour heatmap.
 */
export function ChannelsPage() {
  const { filters } = useFilters()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const channelsQuery = useQuery({
    queryKey: queryKeys.channels(filters),
    queryFn: () => fetchChannels(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const hourlyQuery = useQuery({
    queryKey: queryKeys.channelsHourly(filters),
    queryFn: () => fetchChannelsHourly(filters, auth),
    staleTime: STALE_TIME.kpis,
  })

  const channels = channelsQuery.data?.data.channels
  // API-supplied meta notes (e.g. the hourly endpoint's "each channel row
  // sums to its 30-day order total") — the closest thing to a scope line
  // these endpoints offer. Rendered verbatim; nothing is fabricated.
  const metaNotes = [channelsQuery.data?.meta?.note, hourlyQuery.data?.meta?.note].filter(
    (n): n is string => Boolean(n),
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Scope / reconciliation line */}
      {metaNotes.length > 0 && (
        <p className="font-mono text-[10px] text-subtle">
          {metaNotes.join(' · ')}
          {(channelsQuery.isFetching || hourlyQuery.isFetching) && (
            <span className="ml-2 text-primary">refreshing…</span>
          )}
        </p>
      )}

      {/* Per-channel economics cards (compare query) */}
      <ChannelCards
        channels={channels}
        loading={channelsQuery.isLoading}
        error={channelsQuery.error}
        onRetry={() => void channelsQuery.refetch()}
      />

      {/* Channel × hour heatmap (hourly query — independent of the compare feed) */}
      <ChannelHourlyHeatmap
        hourly={hourlyQuery.data?.data}
        loading={hourlyQuery.isLoading}
        error={hourlyQuery.error}
        onRetry={() => void hourlyQuery.refetch()}
      />

      {/* Full comparison table (compare query) */}
      <ChannelEconomicsTable
        channels={channels}
        loading={channelsQuery.isLoading}
        error={channelsQuery.error}
        onRetry={() => void channelsQuery.refetch()}
      />
    </div>
  )
}
