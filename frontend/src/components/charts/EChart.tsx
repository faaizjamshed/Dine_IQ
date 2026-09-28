import * as React from 'react'
import * as echarts from 'echarts/core'
import {
  BarChart,
  HeatmapChart,
  SankeyChart,
  GraphChart,
  RadarChart,
  ScatterChart,
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { cn } from '@/lib/utils'

echarts.use([
  BarChart,
  HeatmapChart,
  SankeyChart,
  GraphChart,
  RadarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

export type EChartsOption = echarts.EChartsCoreOption

interface EChartProps {
  /** Full ECharts option — built by the caller from API data only. */
  option: EChartsOption
  height?: number
  className?: string
  ariaLabel?: string
  /** Changing this key forces a full re-init (used for theme switches). */
  themeKey?: string
}

/**
 * EChart — managed Apache ECharts instance (spec §05).
 *
 * Handles init/dispose lifecycle, container resize via ResizeObserver and
 * option updates with `notMerge` so stale series never linger. Components
 * pass pure data; this wrapper owns zero business values.
 */
export const EChart = React.memo(function EChart({
  option,
  height = 280,
  className,
  ariaLabel,
  themeKey,
}: EChartProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const chartRef = React.useRef<echarts.ECharts | null>(null)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el)
    chartRef.current = chart

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)

    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [themeKey])

  React.useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className={cn('echart-container w-full', className)}
      style={{ height }}
    />
  )
})
