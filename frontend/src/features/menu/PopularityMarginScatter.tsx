import * as React from 'react'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton, ChartLegend } from '@/components/charts'
import { EChart, type EChartsOption } from '@/components/charts/EChart'
import { getChartTheme, performanceClassColor } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatPct, formatNumberCompact, formatRating, humanize } from '@/lib/formatters'
import type { MenuScatter, MenuScatterPoint, PerformanceClass } from '@/api/types'

const CLASS_ORDER: { key: PerformanceClass; label: string }[] = [
  { key: 'profit_driver', label: 'Profit Driver' },
  { key: 'volume_driver', label: 'Volume Driver' },
  { key: 'hidden_opportunity', label: 'Hidden Opportunity' },
  { key: 'low_performer', label: 'Low Performer' },
]

/**
 * PopularityMarginScatter — the Menu Intelligence centrepiece (spec §25).
 *
 * X = API-supplied popularity share (share of tracked quantity sold),
 * Y = contribution margin %. Dot color = API performance class. The dashed
 * guide lines sit at the API-computed quadrant medians, and the quadrant
 * captions are the API's own `quadrantLabels` — nothing is labeled or
 * classified client-side.
 *
 * Data: GET /api/intelligence/menu → data.scatter.
 */
export function PopularityMarginScatter({
  scatter,
  loading,
  error,
  onRetry,
  className,
}: {
  scatter?: MenuScatter
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  const option = React.useMemo<EChartsOption | null>(() => {
    if (!scatter || scatter.points.length === 0) return null

    const series = CLASS_ORDER.map(({ key, label }) => ({
      name: label,
      type: 'scatter' as const,
      data: scatter.points
        .filter((p) => p.performanceClass === key)
        .map((p) => ({
          value: [Math.round(p.popularityShare * 10000) / 100, p.marginPct],
          payload: p,
        })),
      symbolSize: 14,
      itemStyle: {
        color: performanceClassColor(key, theme),
        opacity: 0.82,
        borderColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(11,16,32,0.9)',
        borderWidth: 1,
      },
      emphasis: { scale: 1.35 },
    }))

    return {
      backgroundColor: 'transparent',
      textStyle: { color: theme.text, fontFamily: 'Plus Jakarta Sans, sans-serif' },
      grid: { top: 30, right: 24, bottom: 44, left: 52 },
      legend: {
        top: 0,
        left: 0,
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: theme.textMuted, fontSize: 11 },
        itemGap: 14,
      },
      xAxis: {
        type: 'value',
        name: 'Popularity share (%)',
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: theme.textMuted, fontSize: 10 },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { color: theme.gridLine } },
        axisLine: { lineStyle: { color: theme.axisLine } },
        scale: true,
      },
      yAxis: {
        type: 'value',
        name: 'Margin (%)',
        nameLocation: 'middle',
        nameGap: 42,
        nameTextStyle: { color: theme.textMuted, fontSize: 10 },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { color: theme.gridLine } },
        axisLine: { lineStyle: { color: theme.axisLine } },
        scale: true,
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.tooltipText, fontSize: 11 },
        formatter: (params: { data?: { payload?: MenuScatterPoint } }) => {
          const p = params?.data?.payload
          if (!p) return ''
          return (
            `<div style="max-width:240px">` +
            `<p style="font-weight:700;margin-bottom:2px">${p.name}</p>` +
            `<p style="opacity:.75;margin-bottom:6px">${p.category} · ${humanize(p.performanceClass)}</p>` +
            `<p>Margin: <b>${formatPct(p.marginPct)}</b></p>` +
            `<p>Popularity share: <b>${formatPct(p.popularityShare * 100, 2)}</b></p>` +
            `<p>Revenue: <b>${formatPKR(p.revenue, { compact: true })}</b> · ${formatNumberCompact(p.quantity)} sold</p>` +
            `<p>Rating: <b>${formatRating(p.rating)}</b> · 90d trend <b>${p.trendPct > 0 ? '+' : ''}${p.trendPct}%</b></p>` +
            (p.inQuadrantStar ? `<p style="margin-top:4px;color:${theme.series.emerald}">Above both backend thresholds</p>` : '') +
            `</div>`
          )
        },
      },
      series: [
        ...series,
        {
          // Quadrant guides at the API medians (dashed reference lines).
          type: 'scatter' as const,
          data: [],
          markLine: {
            silent: true,
            symbol: 'none',
            animation: false,
            lineStyle: { color: theme.axisLine, type: 'dashed', width: 1 },
            label: { show: false },
            data: [
              { xAxis: Math.round(scatter.medianPopularityShare * 10000) / 100 },
              { yAxis: scatter.medianMarginPct },
            ],
          },
        },
      ],
    }
  }, [scatter, theme, isLight])

  if (error) {
    return (
      <ChartCard
        title="Popularity × Margin"
        subtitle="Menu quadrants with backend 75th-percentile thresholds"
        className={className}
      >
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the menu scatter." />
      </ChartCard>
    )
  }

  if (loading || !scatter) {
    return (
      <ChartCard
        title="Popularity × Margin"
        subtitle="Menu quadrants with backend 75th-percentile thresholds"
        className={className}
      >
        <ChartSkeleton height={340} />
      </ChartCard>
    )
  }

  if (scatter.points.length === 0) {
    return (
      <ChartCard
        title="Popularity × Margin"
        subtitle="Menu quadrants with backend 75th-percentile thresholds"
        className={className}
      >
        <ChartEmpty message="No tracked items for the selected filters." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="Popularity × Margin"
      subtitle={`Backend 75th-percentile thresholds: ${formatPct(scatter.medianPopularityShare * 100, 2)} popularity · ${formatPct(scatter.medianMarginPct)} margin`}
      className={className}
    >
      <EChart
        option={option ?? {}}
        height={340}
        themeKey={isLight ? 'light' : 'dark'}
        ariaLabel="Scatter plot of menu item popularity versus contribution margin"
      />
      <div className="mt-2 flex flex-col gap-1.5">
        <ChartLegend
          items={CLASS_ORDER.map(({ key, label }) => ({
            label,
            color: performanceClassColor(key, theme),
          }))}
        />
        <p className="font-mono text-[10px] leading-relaxed text-subtle">
          Quadrants (API labels): “{scatter.quadrantLabels.high}” · “{scatter.quadrantLabels.low}”
        </p>
      </div>
    </ChartCard>
  )
}
