import * as React from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatPct, formatNumberCompact } from '@/lib/formatters'
import type { ChannelMixPoint } from '@/api/types'

const CHANNEL_COLORS: Record<string, 'primary' | 'sky' | 'emerald' | 'violet'> = {
  'Dine-In': 'primary',
  'Delivery Partner': 'sky',
  'Takeaway': 'emerald',
  'Mobile App': 'violet',
  'Website': 'primary',
  dine_in: 'primary',
  delivery: 'sky',
  takeaway: 'emerald',
  app: 'violet',
}

/**
 * ChannelMixCard — revenue share by ordering channel (spec §24).
 *
 * Donut data comes from kpis.channelMix (GET /api/overview). Shares and revenue
 * are rendered verbatim; channel colors are presentation-only.
 */
export function ChannelMixCard({
  points,
  loading,
  error,
  onRetry,
  className,
}: {
  points?: ChannelMixPoint[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  if (error) {
    return (
      <ChartCard title="Channel Mix" subtitle="Revenue share by ordering channel" className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load channel mix." />
      </ChartCard>
    )
  }

  if (loading || !points) {
    return (
      <ChartCard title="Channel Mix" subtitle="Revenue share by ordering channel" className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }

  if (points.length === 0) {
    return (
      <ChartCard title="Channel Mix" subtitle="Revenue share by ordering channel" className={className}>
        <ChartEmpty message="No channel data for the selected filters." />
      </ChartCard>
    )
  }

  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0)
  const colorOf = (channel: string) =>
    theme.series[CHANNEL_COLORS[channel] ?? 'slate']

  return (
    <ChartCard
      title="Channel Mix"
      subtitle="Revenue share by ordering channel"
      className={className}
    >
      <div className="relative" style={{ height: 172 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={points}
              dataKey="revenue"
              nameKey="label"
              innerRadius="66%"
              outerRadius="94%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {points.map((p) => (
                <Cell key={p.channel} fill={colorOf(p.channel)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as ChannelMixPoint
                return (
                  <div
                    className="rounded-lg border p-2.5 text-xs shadow-panel"
                    style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
                  >
                    <p className="font-semibold">{p.label}</p>
                    <p className="mt-1 font-mono">{formatPKR(p.revenue)}</p>
                    <p className="font-mono text-muted">
                      {formatPct(p.share * 100)} share · {formatNumberCompact(p.orders)} orders
                    </p>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wider text-subtle">Total</span>
          <span className="data-value text-lg font-bold text-foreground">
            {formatPKR(totalRevenue, { compact: true })}
          </span>
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {points.map((p) => (
          <li key={p.channel} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: colorOf(p.channel) }}
            />
            <span className="text-muted">{p.label}</span>
            <span className="ml-auto font-mono font-semibold text-foreground">
              {formatPct(p.share * 100, 0)}
            </span>
            <span className="w-20 text-right font-mono text-[10px] text-subtle">
              {formatPKR(p.revenue, { compact: true })}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
