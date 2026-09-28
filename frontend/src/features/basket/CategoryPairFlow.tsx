import { EChart, type EChartsOption } from '@/components/charts/EChart'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatInt } from '@/lib/formatters'
import type { CategoryPairRow } from '@/api/types'

/** hex → rgba — presentational color math for the link tint (not business data). */
function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * CategoryPairFlow — sankey of category co-occurrence
 * (GET /api/intelligence/baskets → categoryPairs). Links are the API rows sorted
 * by pair orders with the top 8 kept for readability; nodes are limited to
 * the categories that appear in the displayed links so the flow has no
 * orphans. Lift rides along on each link for the tooltip — nothing is
 * recomputed client-side.
 */
export function CategoryPairFlow({
  pairs,
  loading,
  error,
  onRetry,
  className,
}: {
  pairs?: CategoryPairRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Category Pair Flow'
  const subtitle = 'Category co-occurrence in the same basket · top 8 pairs by order volume'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load category pairs." />
      </ChartCard>
    )
  }
  if (loading || !pairs) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }
  if (pairs.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="Category-pair totals are unavailable from the existing backend." />
      </ChartCard>
    )
  }

  // Presentation-only ordering: highest-volume pairs first, top 8 kept.
  const topPairs = [...pairs].sort((a, b) => b.pairOrders - a.pairOrders).slice(0, 8)

  const names: string[] = []
  for (const p of topPairs) {
    if (!names.includes(p.categoryA)) names.push(p.categoryA)
    if (!names.includes(p.categoryB)) names.push(p.categoryB)
  }

  const palette = [
    theme.series.primary,
    theme.series.sky,
    theme.series.emerald,
    theme.series.violet,
    theme.series.rose,
    theme.series.primaryStrong,
    theme.series.slate,
  ]
  const nodes = names.map((name, i) => ({
    name,
    itemStyle: { color: palette[i % palette.length] },
  }))
  const links = topPairs.map((p) => ({
    source: p.categoryA,
    target: p.categoryB,
    value: p.pairOrders,
    lift: p.lift,
  }))

  const option: EChartsOption = {
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText, fontSize: 11, fontFamily: 'JetBrains Mono' },
      formatter: (params: unknown) => {
        const p = params as {
          dataType?: string
          name?: string
          data?: { source?: string; target?: string; value?: number; lift?: number }
        }
        if (p.dataType === 'edge' && p.data) {
          return `<b>${p.data.source} → ${p.data.target}</b><br/>${formatInt(p.data.value ?? 0)} pair orders · lift ${(p.data.lift ?? 0).toFixed(1)}×`
        }
        return `<b>${p.name}</b>`
      },
    },
    series: [
      {
        type: 'sankey',
        left: 8,
        right: 150,
        top: 8,
        bottom: 8,
        nodeWidth: 12,
        nodeGap: 10,
        nodeAlign: 'justify',
        data: nodes,
        links,
        emphasis: { focus: 'adjacency' },
        label: {
          color: theme.text,
          fontSize: 10,
          fontFamily: 'JetBrains Mono',
          overflow: 'truncate',
          width: 100,
        },
        lineStyle: { color: hexToRgba(theme.series.primary, 0.35), curveness: 0.5 },
        itemStyle: { borderColor: theme.axisLine, borderWidth: 1 },
      },
    ],
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={<span className="font-mono text-[10px] text-subtle">{topPairs.length} of {pairs.length} pairs</span>}
    >
      <EChart
        option={option}
        height={300}
        themeKey={isLight ? 'light' : 'dark'}
        ariaLabel="Sankey diagram of menu category co-occurrence in the same basket"
      />
    </ChartCard>
  )
}
