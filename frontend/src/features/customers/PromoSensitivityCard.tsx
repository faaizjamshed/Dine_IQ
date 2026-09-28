import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import type { PromoSensitivityRow, TopCustomerRow } from '@/api/types'
import { formatPKR, formatInt } from '@/lib/formatters'

/**
 * PromoSensitivityCard — promo-driven vs organic order share per segment
 * (GET /api/intelligence/customers → promoSensitivity). Stacked bars make the
 * discount dependency visible without inventing a metric: the two shares sum
 * to 100 because the API supplies them as complements.
 */
export function PromoSensitivityCard({
  rows,
  loading,
  error,
  onRetry,
  className,
}: {
  rows?: PromoSensitivityRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const title = 'Promotion Sensitivity by Segment'
  const subtitle = 'Share of orders placed on promotion vs organic — discount depth on top'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load promo sensitivity." />
      </ChartCard>
    )
  }
  if (loading || !rows) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No promo sensitivity data for the selected filters." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <span className="font-mono text-[10px] text-subtle">
          Deepest: {rows.reduce((a, b) => (b.avgDiscountDepthPct > a.avgDiscountDepthPct ? b : a)).segment}
        </span>
      }
    >
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={theme.gridLine} vertical={false} />
          <XAxis
            dataKey="segment"
            tick={{ fill: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={{ stroke: theme.axisLine }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fill: theme.textMuted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 11,
              fontFamily: 'JetBrains Mono',
              color: theme.tooltipText,
            }}
            formatter={(value: number | string, name: string) => [`${value}%`, name]}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: theme.textMuted }}
            iconType="circle"
            iconSize={7}
          />
          <Bar dataKey="promoSharePct" name="On promotion" stackId="promo" fill={theme.series.rose} radius={[0, 0, 0, 0]} maxBarSize={44} />
          <Bar dataKey="organicSharePct" name="Organic" stackId="promo" fill={theme.series.emerald} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const RISK_BADGE: Record<TopCustomerRow['churnRisk'], string> = {
  inactive: 'bg-medium/15 text-medium',
  high: 'bg-critical/15 text-critical',
  medium: 'bg-medium/15 text-medium',
  low: 'bg-positive/15 text-positive',
}

/**
 * TopCustomersTable — highest lifetime-value accounts with churn flags
 * (GET /api/intelligence/customers → topCustomers). Identities are masked
 * upstream (CUST-#####); the table adds zero computed columns.
 */
export function TopCustomersTable({
  customers,
  loading,
  className,
}: {
  customers?: TopCustomerRow[]
  loading?: boolean
  className?: string
}) {
  const title = 'Win-back Shortlist'
  const subtitle = 'Highest historical monetary value among 90+ day inactive customers'

  if (loading || !customers) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-y-auto dineiq-scrollbar"
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Customer</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Segment</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Orders</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Historical value</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Last order</th>
            <th scope="col" className="py-2 text-right font-semibold">Risk</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2 font-mono text-[11px] text-foreground">{c.id}</td>
              <td className="py-2 pr-2 text-muted">{c.segment}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{formatInt(c.orders)}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-foreground">
                {formatPKR(c.lifetimeValue, { compact: true })}
              </td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{c.lastOrderDaysAgo}d</td>
              <td className="py-2 text-right">
                <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize ${RISK_BADGE[c.churnRisk]}`}>
                  {c.churnRisk}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
