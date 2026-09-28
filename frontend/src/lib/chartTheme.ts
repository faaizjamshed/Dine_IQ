/**
 * Chart theming — resolves colors from the active theme without touching the
 * DOM. `getChartTheme(isLight)` is the single source of truth for ECharts and
 * Recharts styling so both libraries stay visually identical (spec §07/08).
 */

export interface ChartTheme {
  text: string
  textMuted: string
  gridLine: string
  axisLine: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  series: {
    primary: string
    primaryStrong: string
    sky: string
    emerald: string
    violet: string
    rose: string
    slate: string
  }
  heatmap: [string, string, string]
  annotation: Record<string, string>
}

const DARK: ChartTheme = {
  text: '#e7ebf4',
  textMuted: '#9aa7bd',
  gridLine: 'rgba(255,255,255,0.07)',
  axisLine: 'rgba(255,255,255,0.14)',
  tooltipBg: 'rgba(13, 18, 38, 0.96)',
  tooltipBorder: 'rgba(255,255,255,0.12)',
  tooltipText: '#e7ebf4',
  series: {
    primary: '#f59e0b',
    primaryStrong: '#f97316',
    sky: '#38bdf8',
    emerald: '#34d399',
    violet: '#a78bfa',
    rose: '#fb7185',
    slate: '#94a3b8',
  },
  heatmap: ['rgba(245,158,11,0.08)', '#f59e0b', '#fb923c'],
  annotation: {
    promotion: '#f59e0b',
    anomaly: '#fb7185',
    peak: '#34d399',
    price_change: '#a78bfa',
    forecast_boundary: '#38bdf8',
  },
}

const LIGHT: ChartTheme = {
  text: '#0f172a',
  textMuted: '#475569',
  gridLine: 'rgba(15,23,42,0.08)',
  axisLine: 'rgba(15,23,42,0.16)',
  tooltipBg: 'rgba(255,255,255,0.98)',
  tooltipBorder: 'rgba(15,23,42,0.12)',
  tooltipText: '#0f172a',
  series: {
    primary: '#d97706',
    primaryStrong: '#ea580c',
    sky: '#0284c7',
    emerald: '#059669',
    violet: '#7c3aed',
    rose: '#e11d48',
    slate: '#64748b',
  },
  heatmap: ['rgba(217,119,6,0.08)', '#d97706', '#ea580c'],
  annotation: {
    promotion: '#d97706',
    anomaly: '#e11d48',
    peak: '#059669',
    price_change: '#7c3aed',
    forecast_boundary: '#0284c7',
  },
}

export function getChartTheme(isLight: boolean): ChartTheme {
  return isLight ? LIGHT : DARK
}

/** Performance-class → chart color, consistent with business colour spec §08. */
export function performanceClassColor(
  performanceClass: string,
  theme: ChartTheme,
): string {
  switch (performanceClass) {
    case 'profit_driver':
      return theme.series.emerald
    case 'volume_driver':
      return theme.series.sky
    case 'hidden_opportunity':
      return theme.series.violet
    case 'low_performer':
      return theme.series.rose
    default:
      return theme.series.slate
  }
}
