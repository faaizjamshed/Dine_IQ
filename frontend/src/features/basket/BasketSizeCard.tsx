import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatInt } from '@/lib/formatters'
import type { BasketSizeSlice } from '@/api/types'

/**
 * BasketSizeCard — basket size distribution
 * (GET /api/intelligence/baskets → basketSizeDist). Bars are the API's sharePct
 * per line-item count; the tooltip also surfaces the basket count the API
 * supplies per bucket. No distribution is recomputed client-side.
 */
export function BasketSizeCard({
  slices,
  loading,
  error,
  onRetry,
  className,
}: {
  slices?: BasketSizeSlice[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Basket Size Distribution'
  const subtitle = 'Share of baskets by line-item count'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load basket size distribution." />
      </ChartCard>
    )
  }
  if (loading || !slices) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (slices.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="Basket-size distribution is unavailable from the existing backend." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={<span className="font-mono text-[10px] text-subtle">{slices.length} buckets</span>}
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={slices} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={theme.gridLine} vertical={false} />
          <XAxis
            dataKey="size"
            tickFormatter={(size: number) => `${size}`}
            tick={{ fill: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={{ stroke: theme.axisLine }}
            tickLine={false}
            interval={0}
            label={{
              value: 'line items in basket',
              position: 'insideBottom',
              offset: -2,
              fill: theme.textMuted,
              fontSize: 9,
              fontFamily: 'JetBrains Mono',
            }}
          />
          <YAxis
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const slice = payload[0].payload as BasketSizeSlice
              return (
                <div
                  className="rounded-lg border p-2.5 text-xs shadow-panel"
                  style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
                >
                  <p className="font-mono font-semibold">{slice.size} {slice.size === 1 ? 'item' : 'items'}</p>
                  <p className="mt-1">
                    <span className="text-muted">Share: </span>
                    <span className="font-mono font-bold">{slice.sharePct}%</span>
                  </p>
                  <p>
                    <span className="text-muted">Baskets: </span>
                    <span className="font-mono font-bold">{formatInt(slice.baskets)}</span>
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="sharePct" fill={theme.series.primary} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
