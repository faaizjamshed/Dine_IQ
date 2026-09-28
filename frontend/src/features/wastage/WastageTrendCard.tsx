import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartLegend, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatDateShort, formatAxisCompact, formatPKR, formatPct } from '@/lib/formatters'
import type { WastageTrendPoint } from '@/api/types'

/**
 * WastageTrendCard — daily wastage cost as a rose gradient area (left axis)
 * against wastage as % of revenue as a primary line (right axis)
 * (GET /api/intelligence/wastage → trend). Both series render exactly as the API
 * supplies them — no smoothing, interpolation or gap filling.
 */
export function WastageTrendCard({
  trend,
  loading,
  error,
  onRetry,
  className,
}: {
  trend?: WastageTrendPoint[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Wastage Trend'
  const subtitle = 'Daily wasted cost vs % of revenue'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the wastage trend." />
      </ChartCard>
    )
  }
  if (loading || !trend) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }
  if (trend.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No wastage trend for the selected filters." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <ChartLegend
          className="justify-end"
          items={[
            { label: 'Wastage cost', color: theme.series.rose },
            { label: '% of revenue', color: theme.series.primary },
          ]}
        />
      }
    >
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="wastage-cost-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.series.rose} stopOpacity={0.32} />
                <stop offset="100%" stopColor={theme.series.rose} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={theme.gridLine} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              tick={{ fill: theme.textMuted, fontSize: 10 }}
              axisLine={{ stroke: theme.axisLine }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={formatAxisCompact}
              tick={{ fill: theme.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: theme.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              cursor={{ stroke: theme.axisLine }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const point = payload[0].payload as WastageTrendPoint
                return (
                  <div
                    className="rounded-lg border p-2.5 text-xs shadow-panel"
                    style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
                  >
                    <p className="font-mono font-semibold">{formatDateShort(point.date)}</p>
                    <p className="mt-1">
                      <span className="text-muted">Wastage cost: </span>
                      <span className="font-mono font-bold">{formatPKR(point.wastageCost)}</span>
                    </p>
                    <p>
                      <span className="text-muted">% of revenue: </span>
                      <span className="font-mono font-bold">{formatPct(point.wastagePct)}</span>
                    </p>
                  </div>
                )
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="wastageCost"
              stroke={theme.series.rose}
              strokeWidth={2}
              fill="url(#wastage-cost-fill)"
              dot={false}
              activeDot={{ r: 3.5, fill: theme.series.rose, stroke: theme.tooltipBg }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="wastagePct"
              stroke={theme.series.primary}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3, fill: theme.series.primary, stroke: theme.tooltipBg }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
