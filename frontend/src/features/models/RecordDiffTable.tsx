import { Check, X } from 'lucide-react'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import type { RecordDiffRow } from '@/api/types'

/**
 * RecordDiffTable — sampled record-level diffs between the Spark and Python
 * outputs from GET /api/ml/demand-comparison → recordDiffSample (recordId,
 * field, sparkValue, pythonValue, match). Values are API strings rendered
 * verbatim in mono. Mismatch rows get a subtle rose background; the Match
 * column is a Check/X icon with an aria-label for screen readers.
 */
export function RecordDiffTable({
  rows,
  loading,
  error,
  onRetry,
  className,
}: {
  rows?: RecordDiffRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Record-Level Diff Sample'
  const subtitle = 'Fields where the two pipelines were compared record by record'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the record diff sample." />
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
        <ChartEmpty message="No sampled diffs in the parity audit payload." />
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
            <th scope="col" className="py-2 pr-2 font-semibold">Record</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Field</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Spark</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Python</th>
            <th scope="col" className="py-2 text-right font-semibold">Match</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.recordId}-${r.field}`}
              className={`border-t border-border/60 text-xs ${r.match ? '' : 'bg-critical/5'}`}
            >
              <td className="py-2 pr-2 font-mono text-[11px] text-foreground">{r.recordId}</td>
              <td className="py-2 pr-2 font-mono text-[11px] text-muted">{r.field}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-foreground">{r.sparkValue}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-foreground">{r.pythonValue}</td>
              <td className="py-2 text-right">
                {r.match ? (
                  <Check
                    className="ml-auto h-3.5 w-3.5 text-positive"
                    role="img"
                    aria-label={`${r.recordId} ${r.field}: values match`}
                  />
                ) : (
                  <X
                    className="ml-auto h-3.5 w-3.5 text-critical"
                    role="img"
                    aria-label={`${r.recordId} ${r.field}: values differ`}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
