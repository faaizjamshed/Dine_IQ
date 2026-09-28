import { useMemo } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartLegend, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatDateShort, formatAxisCompact, formatInt } from '@/lib/formatters'
import type { ForecastDay } from '@/api/types'

/** #rrggbb → rgba(r, g, b, a) so band/legend colors follow the active theme. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface ChartPoint {
  date: string
  actual?: number
  forecast: number
  lower: number
  upper: number
  /** upper − lower, computed per point for the stacked confidence-band trick. */
  spread: number
}

/**
 * ForecastChart — the demand-forecast centerpiece
 * (GET /api/ml/demand-comparison → daily).
 *
 * Band construction (from the API's lower/upper fields): Recharts has no
 * native range area, so the 90% band is drawn with TWO stacked areas on one
 * stackId — an invisible `lower` area, then a `spread` area (upper − lower)
 * whose fill is the band. Where the API supplies lower = upper (historical
 * days) the spread is 0 and no band is painted, so the shading naturally
 * covers only the forecast horizon.
 *
 * Series: `actual` (emerald, undefined on forecast days, connectNulls off)
 * and `forecast` (primary) exactly as the API ships them — the historical
 * overlap of the two lines IS the model fit the backend reports. A sky
 * ReferenceLine marks the first forecast date supplied by the API.
 *
 * Every value is a model estimate on/after the boundary line; the KPI row
 * and ModelMetadata carry the model attribution.
 */
export function ForecastChart({
  daily,
  loading,
  error,
  onRetry,
  className,
}: {
  daily?: ForecastDay[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Demand Forecast vs Actuals'
  const subtitle = 'Daily forecast and confidence intervals unavailable; use the hourly predictor'

  const points = useMemo<ChartPoint[]>(
    () =>
      (daily ?? []).map((d) => ({
        date: d.date,
        actual: d.actual,
        forecast: d.forecast,
        lower: d.lower,
        upper: d.upper,
        spread: Math.max(d.upper - d.lower, 0),
      })),
    [daily],
  )

  const firstForecastDate = useMemo(
    () => (daily ?? []).find((d) => d.isForecast)?.date,
    [daily],
  )

  const band = withAlpha(theme.series.primary, 0.14)

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the demand forecast." />
      </ChartCard>
    )
  }
  if (loading || !daily) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }
  if (points.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty
          message="No forecast data for the selected filters."
          hint="Adjust the date range or clear filters to see the modelled window."
        />
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
          items={[
            { label: 'Actual', color: theme.series.emerald },
            { label: 'Forecast', color: theme.series.primary },
            { label: '90% band', color: withAlpha(theme.series.primary, 0.35) },
          ]}
          className="justify-end"
        />
      }
    >
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={theme.gridLine} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              tick={{ fill: theme.textMuted, fontSize: 9 }}
              axisLine={{ stroke: theme.axisLine }}
              tickLine={false}
              interval={4}
            />
            <YAxis
              tickFormatter={formatAxisCompact}
              tick={{ fill: theme.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={['dataMin - 120', 'dataMax + 120']}
            />
            <Tooltip
              cursor={{ stroke: theme.axisLine }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as ChartPoint
                return (
                  <div
                    className="rounded-lg border p-2.5 text-xs shadow-panel"
                    style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
                  >
                    <p className="font-mono font-semibold">{formatDateShort(p.date)}</p>
                    <p className="mt-1">
                      <span className="text-muted">Actual: </span>
                      <span className="font-mono font-bold">
                        {p.actual === undefined ? '—' : formatInt(p.actual)}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted">Forecast: </span>
                      <span className="font-mono font-bold">{formatInt(p.forecast)}</span>
                    </p>
                    <p>
                      <span className="text-muted">90% band: </span>
                      <span className="font-mono">
                        {formatInt(p.lower)} – {formatInt(p.upper)}
                      </span>
                    </p>
                  </div>
                )
              }}
            />

            {/* 90% confidence band — stacked Areas built from API lower/upper */}
            <Area
              type="monotone"
              dataKey="lower"
              stackId="band"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="spread"
              stackId="band"
              stroke="none"
              fill={band}
              isAnimationActive={false}
            />

            {/* Boundary between history and the modelled horizon (API-supplied date) */}
            {firstForecastDate && (
              <ReferenceLine
                x={firstForecastDate}
                stroke={theme.series.sky}
                strokeDasharray="4 3"
                label={{
                  value: 'forecast →',
                  position: 'insideTopLeft',
                  fill: theme.series.sky,
                  fontSize: 9,
                  fontFamily: 'JetBrains Mono',
                }}
              />
            )}

            {/* Forecast line first so the observed actuals render on top of the fit */}
            <Line
              type="monotone"
              dataKey="forecast"
              stroke={theme.series.primary}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: theme.series.primary, stroke: theme.tooltipBg }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke={theme.series.emerald}
              strokeWidth={2}
              dot={{ r: 1.8, fill: theme.series.emerald, strokeWidth: 0 }}
              connectNulls={false}
              activeDot={{ r: 3.5, fill: theme.series.emerald, stroke: theme.tooltipBg }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
