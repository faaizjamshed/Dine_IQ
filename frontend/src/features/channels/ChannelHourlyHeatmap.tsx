import { EChart, type EChartsOption } from '@/components/charts/EChart'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatInt } from '@/lib/formatters'
import type { ChannelsHourlyData } from '@/api/types'

type ChannelsHourly = ChannelsHourlyData

/**
 * ChannelHourlyHeatmap — orders by channel × hour-of-day
 * (GET /api/channels/hourly → data). Rows are channel labels, columns are
 * the trading hours the API ships ("10"…"23"); cells are order counts.
 *
 * Each channel row sums to its 30-day order total — an adapter/endpoint
 * guarantee surfaced verbatim in the response meta note — so the heatmap
 * reconciles with the channel cards above it. Missing channel/hour pairs
 * render as empty grid cells (ECharts skips nulls), never as zeros.
 *
 * Same heatmap construction as the cohort retention card: category axes,
 * visualMap scaled to the API max, tooltip carries the exact order count.
 */
export function ChannelHourlyHeatmap({
  hourly,
  loading,
  error,
  onRetry,
  className,
}: {
  hourly?: ChannelsHourly
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Channel × Hour Order Heatmap'
  const subtitle = 'Hourly channel detail is unavailable in the existing backend'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the hourly channel heatmap." />
      </ChartCard>
    )
  }
  if (loading || !hourly) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (hourly.values.length === 0 || hourly.channels.length === 0 || hourly.hours.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No hourly channel data for the selected filters." />
      </ChartCard>
    )
  }

  const channelIndex = new Map(hourly.channels.map((c, i) => [c.channel, i]))
  const hourIndex = new Map(hourly.hours.map((h, i) => [h, i]))

  // ECharts heatmap skips null cells — unobserved channel/hour pairs render
  // as empty grid instead of fake zeros.
  const data: [number, number, number | null][] = []
  const seen = new Set<string>()
  for (const v of hourly.values) {
    const x = hourIndex.get(v.hour)
    const y = channelIndex.get(v.channel)
    if (x === undefined || y === undefined) continue
    data.push([x, y, v.orders])
    seen.add(`${y}:${x}`)
  }
  for (let y = 0; y < hourly.channels.length; y++) {
    for (let x = 0; x < hourly.hours.length; x++) {
      if (!seen.has(`${y}:${x}`)) data.push([x, y, null])
    }
  }

  const maxOrders = data.reduce((m, d) => Math.max(m, d[2] ?? 0), 0)
  const hourLabels = hourly.hours.map((h) => `${h}`)
  const channelLabels = hourly.channels.map((c) => c.label)
  const height = Math.max(220, hourly.channels.length * 36 + 90)

  const option: EChartsOption = {
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText, fontSize: 11, fontFamily: 'JetBrains Mono' },
      formatter: (params: unknown) => {
        const p = params as { value: [number, number, number | null] }
        const channel = channelLabels[p.value[1]]
        const hour = `${hourly.hours[p.value[0]]}:00`
        if (p.value[2] === null || p.value[2] === undefined) return `${channel} · ${hour} — no data`
        return `<b>${channel}</b> · ${hour} — ${formatInt(p.value[2])} orders`
      },
    },
    grid: { left: 6, right: 48, top: 6, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: hourLabels,
      axisLabel: { color: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: channelLabels,
      axisLabel: { color: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
      inverse: true,
    },
    visualMap: {
      min: 0,
      max: maxOrders,
      calculable: false,
      orient: 'vertical',
      right: 0,
      top: 'center',
      itemHeight: 90,
      itemWidth: 10,
      textStyle: { color: theme.textMuted, fontSize: 9, fontFamily: 'JetBrains Mono' },
      inRange: { color: [theme.heatmap[0], theme.heatmap[1], theme.heatmap[2]] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderRadius: 3, borderColor: 'transparent', borderWidth: 2 },
        label: { show: false },
      },
    ],
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <span className="font-mono text-[10px] text-subtle">
          {channelLabels.length} channels × {hourLabels.length} hours
        </span>
      }
    >
      <EChart
        option={option}
        height={height}
        themeKey={isLight ? 'light' : 'dark'}
        ariaLabel="Heatmap of orders per channel per trading hour"
      />
    </ChartCard>
  )
}
