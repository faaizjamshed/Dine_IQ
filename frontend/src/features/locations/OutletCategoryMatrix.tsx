import { EChart, type EChartsOption } from '@/components/charts/EChart'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR } from '@/lib/formatters'
import type { LocationsDetailData } from '@/api/types'

type LocationMatrix = LocationsDetailData['matrix']

/**
 * OutletCategoryMatrix — revenue heatmap of every outlet × menu category
 * (GET /api/reports/locations_menu → data.matrix). Rows are outlets (up to 24, so
 * the chart height scales with the row count) and columns are the category
 * names the API ships alongside the values.
 *
 * Field mapping: matrix.values carry { outletId, categoryId, revenue }.
 * `categories` is positionally aligned with the categoryId space of the
 * values (the API ships the display names in the same order), so the value's
 * categoryId index is resolved by first-seen order of value.categoryId —
 * which reproduces the API ordering without guessing ids.
 *
 * Axes are inverted vs the cohort retention heatmap: categories run along X
 * (labels rotated 30°) and outlets are Y rows (top = first outlet).
 */
export function OutletCategoryMatrix({
  matrix,
  loading,
  error,
  onRetry,
  className,
}: {
  matrix?: LocationMatrix
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Outlet × Category Revenue Matrix'
  const subtitle = 'Revenue by outlet (rows) and menu category (columns)'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the outlet × category matrix." />
      </ChartCard>
    )
  }
  if (loading || !matrix) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={480} />
      </ChartCard>
    )
  }
  if (matrix.values.length === 0 || matrix.outletNames.length === 0 || matrix.categories.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No matrix data for the selected filters." />
      </ChartCard>
    )
  }

  const outletIndex = new Map(matrix.outletIds.map((id, i) => [id, i]))
  const categoryIndex = new Map<string, number>(matrix.categories.map((name, i) => [name, i]))
  for (const v of matrix.values) {
    if (!categoryIndex.has(v.categoryId)) categoryIndex.set(v.categoryId, categoryIndex.size)
  }

  const data: [number, number, number][] = []
  for (const v of matrix.values) {
    const x = categoryIndex.get(v.categoryId)
    const y = outletIndex.get(v.outletId)
    if (x === undefined || y === undefined) continue
    data.push([x, y, v.revenue])
  }

  const maxRevenue = data.reduce((m, d) => Math.max(m, d[2]), 0)
  // 24 rows × ~18px + axis/legend padding — keeps cells square-ish and the
  // card readable without scrolling; never shorter than 480px.
  const height = Math.max(480, matrix.outletNames.length * 18 + 90)

  const option: EChartsOption = {
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText, fontSize: 11, fontFamily: 'JetBrains Mono' },
      formatter: (params: unknown) => {
        const p = params as { value: [number, number, number] }
        const outlet = matrix.outletNames[p.value[1]]
        const category = matrix.categories[p.value[0]]
        return `<b>${outlet}</b> · ${category}: ${formatPKR(p.value[2], { compact: true })}`
      },
    },
    grid: { left: 6, right: 48, top: 6, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: matrix.categories,
      axisLabel: {
        color: theme.textMuted,
        fontSize: 10,
        fontFamily: 'JetBrains Mono',
        rotate: 30,
        width: 90,
        overflow: 'truncate',
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: matrix.outletNames,
      axisLabel: { color: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' },
      axisLine: { show: false },
      axisTick: { show: false },
      inverse: true,
    },
    visualMap: {
      min: 0,
      max: maxRevenue,
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
        // 24×12 = 288 cells: inline labels would be illegible — exact values
        // surface in the tooltip instead.
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
          {matrix.outletNames.length} outlets × {matrix.categories.length} categories
        </span>
      }
    >
      <EChart
        option={option}
        height={height}
        themeKey={isLight ? 'light' : 'dark'}
        ariaLabel="Heatmap of revenue by outlet and menu category"
      />
    </ChartCard>
  )
}
