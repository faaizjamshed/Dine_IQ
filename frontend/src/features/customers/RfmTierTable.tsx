import { formatDecimal } from '@/lib/formatters'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import type { RfmTier, ChurnRiskBucket } from '@/api/types'

const TIER_ACCENT: Record<string, string> = {
  Champions: 'bg-positive',
  Loyal: 'bg-positive/70',
  'Potential Loyalist': 'bg-primary',
  'At Risk': 'bg-negative',
  Hibernating: 'bg-low',
}

/**
 * RfmTierTable — RFM value tiers with revenue share bars
 * (GET /api/intelligence/customers → rfmTiers). Tier colors follow the business
 * semantics: healthy tiers green, At Risk rose, Hibernating neutral slate.
 */
export function RfmTierTable({
  tiers,
  loading,
  error,
  onRetry,
  className,
}: {
  tiers?: RfmTier[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'RFM Value Tiers — Returned Sample'
  const subtitle = 'Top returned records by monetary value; not population totals'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load RFM tiers." />
      </ChartCard>
    )
  }
  if (loading || !tiers) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }
  if (tiers.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No RFM data for the selected filters." />
      </ChartCard>
    )
  }

  const maxShare = Math.max(...tiers.map((t) => t.revenueShare))

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="flex flex-col gap-2.5"
    >
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-wide text-subtle">
        <span>Tier</span>
        <span className="text-right">Customers</span>
        <span className="text-right">Revenue share</span>
        <span className="text-right">Avg monetary</span>
      </div>
      {tiers.map((t) => (
        <div key={t.tier} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-1.5 truncate text-xs font-semibold text-foreground">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TIER_ACCENT[t.tier] ?? 'bg-low'}`} />
              {t.tier}
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
              <div
                className={`h-full rounded-full ${TIER_ACCENT[t.tier] ?? 'bg-low'}`}
                style={{ width: `${Math.max(2, (t.revenueShare / maxShare) * 100)}%` }}
              />
            </div>
          </div>
          <span className="text-right font-mono text-[11px] text-muted">{formatInt(t.customers)}</span>
          <span className="text-right font-mono text-[11px] text-muted">
            {Math.round(t.revenueShare * 100)}% · {formatPKR(t.revenue, { compact: true })}
          </span>
          <span className="text-right font-mono text-[11px] text-muted">
            {formatPKR(t.avgMonetary, { compact: true })}
            <span className="block text-[9px] text-subtle">
              R{formatDecimal(t.avgRecencyDays)}d · F{formatDecimal(t.avgFrequency)}
            </span>
          </span>
        </div>
      ))}
    </ChartCard>
  )
}

const RISK_STYLES: Record<ChurnRiskBucket['bucket'], { card: string; dot: string }> = {
  high: { card: 'border-critical/30 bg-critical/5', dot: 'bg-critical' },
  medium: { card: 'border-medium/30 bg-medium/5', dot: 'bg-medium' },
  low: { card: 'border-border bg-surface', dot: 'bg-positive' },
}

/**
 * ChurnRiskBuckets — model-scored churn buckets
 * (GET /api/intelligence/customers → churnRisk). High risk carries the red
 * treatment with revenue-at-risk emphasized; scoring lives in the backend.
 */
export function ChurnRiskBuckets({
  buckets,
  loading,
  className,
}: {
  buckets?: ChurnRiskBucket[]
  loading?: boolean
  className?: string
}) {
  const title = 'Customer Inactivity'
  const subtitle = 'Descriptive 90+ day inactivity rule, evaluated at the backend analysis date'

  if (loading || !buckets) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={220} />
      </ChartCard>
    )
  }

  return (
    <ChartCard title={title} subtitle={subtitle} className={className} contentClassName="grid gap-3 sm:grid-cols-3">
      {buckets.map((b) => {
        const style = RISK_STYLES[b.bucket]
        return (
          <div key={b.bucket} className={`flex flex-col gap-1.5 rounded-xl border p-3.5 ${style.card}`}>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span aria-hidden className={`h-2 w-2 rounded-full ${style.dot}`} />
              {b.label}
            </span>
            <span className="data-value text-2xl font-bold leading-none text-foreground">
              {formatInt(b.customers)}
            </span>
            <span className="text-[10px] text-subtle">
              {formatPKR(b.revenueAtRisk, { compact: true })} revenue · last order {formatDecimal(b.avgDaysSinceLastOrder)}d ago
            </span>
          </div>
        )
      })}
    </ChartCard>
  )
}
