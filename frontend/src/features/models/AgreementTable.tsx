import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatInt, formatPct } from '@/lib/formatters'
import type { AgreementRow } from '@/api/types'

/**
 * AgreementTable — per-metric Spark/Python output agreement from
 * GET /api/ml/demand-comparison → agreement (metric, agreementPct, sampleSize,
 * maxDeviationPct). Values render verbatim via the shared formatters — no
 * derived columns.
 */
export function AgreementTable({
  rows,
  loading,
  error,
  onRetry,
  className,
}: {
  rows?: AgreementRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Output Agreement by Metric'
  const subtitle = 'How closely the two pipelines agree on each aggregation contract'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load agreement metrics." />
      </ChartCard>
    )
  }
  if (loading || !rows) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={220} />
      </ChartCard>
    )
  }
  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No agreement metrics in the parity audit payload." />
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
            <th scope="col" className="py-2 pr-2 font-semibold">Metric</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Agreement</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Sample size</th>
            <th scope="col" className="py-2 text-right font-semibold">Max deviation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2 font-semibold text-foreground">{r.metric}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-positive">{formatPct(r.agreementPct)}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-muted">{formatInt(r.sampleSize)}</td>
              <td className="data-value py-2 text-right text-[11px] text-muted">{formatPct(r.maxDeviationPct, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
