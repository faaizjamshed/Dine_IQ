import * as React from 'react'
import { EChart, type EChartsOption } from '@/components/charts/EChart'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatNumberCompact } from '@/lib/formatters'
import type { HourWeekdayMatrix } from '@/api/types'

/**
 * TrafficHeatmapCard — orders by hour × weekday (spec §24), rendered with
 * Apache ECharts. Values come from kpis.hourWeekday (GET /api/overview); the
 * component only reshapes {weekday, hour, orders} cells into grid indexes.
 */
export function TrafficHeatmapCard({
  matrix,
  loading,
  error,
  onRetry,
  className,
}: {
  matrix?: HourWeekdayMatrix
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  if (error) {
    return (
      <ChartCard title="Order Traffic · Hour × Weekday" subtitle="When demand actually lands" className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the traffic heatmap." />
      </ChartCard>
    )
  }

  if (loading || !matrix) {
    return (
      <ChartCard title="Order Traffic · Hour × Weekday" subtitle="When demand actually lands" className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }

  if (!matrix.values || matrix.values.length === 0) {
    return (
      <ChartCard title="Order Traffic · Hour × Weekday" subtitle="When demand actually lands" className={className}>
        <ChartEmpty message="No traffic data for the selected filters." />
      </ChartCard>
    )
  }

  const hourIndex = new Map(matrix.hours.map((h, i) => [h, i]))
  const weekdayIndex = new Map(matrix.weekdays.map((w, i) => [w, i]))
  const data = matrix.values.map((c) => [hourIndex.get(c.hour), weekdayIndex.get(c.weekday), c.orders])
  const maxOrders = Math.max(...matrix.values.map((c) => c.orders))

  const option: EChartsOption = {
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText, fontSize: 11, fontFamily: 'JetBrains Mono' },
      formatter: (params: unknown) => {
        const p = params as { value: [number, number, number] }
        const hour = matrix.hours[p.value[0]]
        const weekday = matrix.weekdays[p.value[1]]
        return `<b>${weekday} ${hour}:00</b> — ${p.value[2].toLocaleString('en-US')} orders`
      },
    },
    grid: { left: 6, right: 10, top: 6, bottom: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: matrix.hours.map((h) => String(h)),
      axisLabel: { color: theme.textMuted, fontSize: 9, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: matrix.weekdays,
      axisLabel: { color: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    visualMap: {
      min: 0,
      max: maxOrders,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 60,
      itemWidth: 10,
      textStyle: { color: theme.textMuted, fontSize: 9, fontFamily: 'JetBrains Mono' },
      inRange: {
        color: [theme.heatmap[0], theme.heatmap[1], theme.heatmap[2]],
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderRadius: 3, borderColor: 'transparent', borderWidth: 1 },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.35)' } },
        label: {
          show: false,
        },
      },
    ],
  }

  return (
    <ChartCard
      title="Order Traffic · Hour × Weekday"
      subtitle="When demand actually lands — lunch and late-dinner peaks drive staffing"
      className={className}
      actions={
        <span className="font-mono text-[10px] text-subtle">
          Peak cell: {formatNumberCompact(maxOrders)} orders
        </span>
      }
    >
      <EChart
        option={option}
        height={300}
        themeKey={isLight ? 'light' : 'dark'}
        ariaLabel="Heatmap of order volume by hour and weekday"
      />
    </ChartCard>
  )
}
