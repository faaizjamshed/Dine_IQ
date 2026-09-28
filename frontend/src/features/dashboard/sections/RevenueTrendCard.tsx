import * as React from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from 'recharts'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartLegend, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatDateShort, formatAxisCompact, formatPKR, formatNumberCompact } from '@/lib/formatters'
import type { RevenueTrend, TrendAnnotation } from '@/api/types'

/**
 * RevenueTrendCard — monthly completed revenue with API-supplied annotations (spec §24).
 *
 * Displays the revenueTrend series from GET /api/overview. Annotation markers
 * (promotion / anomaly / peak / price_change / forecast_boundary) are
 * rendered ONLY when the API includes them — the frontend invents none.
 */
export function RevenueTrendCard({
  trend,
  loading,
  error,
  onRetry,
  className,
}: {
  trend?: RevenueTrend
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  if (error) {
    return (
      <ChartCard title="Revenue Trend" subtitle="Monthly completed revenue with detected events" className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the revenue trend." />
      </ChartCard>
    )
  }

  if (loading || !trend) {
    return (
      <ChartCard title="Revenue Trend" subtitle="Monthly completed revenue with detected events" className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }

  const series = trend.series
  if (series.length === 0) {
    return (
      <ChartCard title="Revenue Trend" subtitle="Monthly completed revenue with detected events" className={className}>
        <ChartEmpty
          message="No revenue data for the selected filters."
          hint="Adjust the date range or clear filters to see the stored historical period."
        />
      </ChartCard>
    )
  }

  const data = series.map((p) => ({
    date: p.date,
    revenue: p.revenue,
    orders: p.orders,
  }))

  const byDate = new Map(data.map((d) => [d.date, d]))
  const annotations = trend.annotations ?? []

  const legendItems = annotations.map((a) => ({
    label: a.label,
    color: theme.annotation[a.type] ?? theme.series.slate,
  }))

  return (
    <ChartCard
      title="Revenue Trend"
      subtitle="Monthly completed revenue with whole calendar months — hover for detail"
      className={className}
      actions={
        legendItems.length > 0 ? <ChartLegend items={legendItems} className="justify-end" /> : undefined
      }
    >
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.series.primary} stopOpacity={0.32} />
                <stop offset="100%" stopColor={theme.series.primary} stopOpacity={0.02} />
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
              tickFormatter={formatAxisCompact}
              tick={{ fill: theme.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={46}
              domain={['dataMin - 120000', 'dataMax + 80000']}
            />
            <Tooltip
              cursor={{ stroke: theme.axisLine }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const point = payload[0].payload as { date: string; revenue: number; orders: number }
                const note = annotations.find((a) => a.date === label)?.note
                return (
                  <div
                    className="rounded-lg border p-2.5 text-xs shadow-panel"
                    style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
                  >
                    <p className="font-mono font-semibold">{formatDateShort(point.date)}</p>
                    <p className="mt-1">
                      <span className="text-muted">Revenue: </span>
                      <span className="font-mono font-bold">{formatPKR(point.revenue)}</span>
                    </p>
                    <p>
                      <span className="text-muted">Orders: </span>
                      <span className="font-mono font-bold">{formatNumberCompact(point.orders)}</span>
                    </p>
                    {note && <p className="mt-1.5 max-w-52 leading-snug text-subtle">{note}</p>}
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={theme.series.primary}
              strokeWidth={2}
              fill="url(#revenue-fill)"
              dot={false}
              activeDot={{ r: 3.5, fill: theme.series.primary, stroke: theme.tooltipBg }}
            />

            {/* API-supplied annotations only */}
            {annotations.map((a: TrendAnnotation) => {
              const color = theme.annotation[a.type] ?? theme.series.slate
              const point = byDate.get(a.date)
              if (a.type === 'promotion' || a.type === 'forecast_boundary') {
                return (
                  <ReferenceLine
                    key={`${a.type}-${a.date}`}
                    x={a.date}
                    stroke={color}
                    strokeDasharray="4 3"
                    label={{
                      value: a.label,
                      position: 'insideTopLeft',
                      fill: color,
                      fontSize: 9,
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                )
              }
              return (
                <ReferenceDot
                  key={`${a.type}-${a.date}`}
                  x={a.date}
                  y={point?.revenue ?? 0}
                  r={5}
                  fill={color}
                  stroke={theme.tooltipBg}
                  strokeWidth={1.5}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
