import { EChart, type EChartsOption } from '@/components/charts/EChart'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import type { CohortRow } from '@/api/types'

/**
 * CohortRetentionCard — monthly cohort retention heatmap
 * (GET /api/intelligence/customers → cohortRetention). Each row is a signup
 * cohort; cells are the % of the cohort still ordering at month M. Values are
 * rendered verbatim — the frontend does not interpolate missing months.
 */
export function CohortRetentionCard({
  cohorts,
  loading,
  error,
  onRetry,
  className,
}: {
  cohorts?: CohortRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Cohort Retention'
  const subtitle = '% of each monthly signup cohort still ordering · M0 → M5'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load cohort retention." />
      </ChartCard>
    )
  }
  if (loading || !cohorts) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }
  if (cohorts.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No cohort data for the selected filters." />
      </ChartCard>
    )
  }

  const maxMonths = Math.max(...cohorts.map((c) => c.retention.length))
  const months = Array.from({ length: maxMonths }, (_, i) => `M${i}`)
  // ECharts heatmap skips null cells — missing months render as empty grid.
  const data: [number, number, number | null][] = []
  cohorts.forEach((c, row) => {
    c.retention.forEach((v, m) => data.push([m, row, v]))
    for (let m = c.retention.length; m < maxMonths; m++) data.push([m, row, null])
  })

  const option: EChartsOption = {
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText, fontSize: 11, fontFamily: 'JetBrains Mono' },
      formatter: (params: unknown) => {
        const p = params as { value: [number, number, number | null] }
        const cohort = cohorts[p.value[1]]
        if (p.value[2] === null || p.value[2] === undefined) return `${cohort.cohort} · ${months[p.value[0]]} — not yet observed`
        return `<b>${cohort.cohort}</b> · ${months[p.value[0]]} — ${p.value[2]}% retained`
      },
    },
    grid: { left: 6, right: 48, top: 6, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: months,
      axisLabel: { color: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: cohorts.map((c) => c.cohort),
      axisLabel: { color: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
      inverse: true,
    },
    visualMap: {
      min: 0,
      max: 100,
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
        label: {
          show: true,
          fontSize: 9,
          fontFamily: 'JetBrains Mono',
          color: theme.text,
          formatter: (params: unknown) => {
            const p = params as { value: [number, number, number | null] }
            return p.value[2] === null ? '' : `${p.value[2]}`
          },
        },
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
          Latest cohort M1: {cohorts[cohorts.length - 2]?.retention[1] ?? '—'}%
        </span>
      }
    >
      <EChart
        option={option}
        height={280}
        themeKey={isLight ? 'light' : 'dark'}
        ariaLabel="Heatmap of monthly cohort retention percentages"
      />
    </ChartCard>
  )
}
