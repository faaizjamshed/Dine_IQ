import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { useTheme } from '@/components/layout/theme'
import { formatInt, formatRelative, humanize } from '@/lib/formatters'
import type { SparkJobRow } from '@/api/types'

/**
 * Presentational duration arithmetic from the API's durationSec — "4m 24s".
 * Display-only formatting of an API-supplied number; never feeds back into
 * data or calculations.
 */
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  let m = Math.floor(sec / 60)
  let s = Math.round(sec % 60)
  if (s === 60) {
    m += 1
    s = 0
  }
  return `${m}m ${s}s`
}

/** Theme-aware job-status tint — success positive, running sky, failed critical. */
function jobStatusClass(status: SparkJobRow['status'], isLight: boolean): string {
  switch (status) {
    case 'unknown': return 'bg-surface-strong text-muted'
    case 'success':
      return 'bg-positive/15 text-positive'
    case 'running':
      return isLight ? 'bg-sky-600/10 text-sky-700' : 'bg-sky-400/15 text-sky-300'
    case 'failed':
      return 'bg-critical/15 text-critical'
  }
}

/**
 * SparkJobsTable — the Spark job monitor from GET /api/system/evidence →
 * sparkJobs (name, status, startedAt, durationSec, stages, cores,
 * rowsShuffled). Stages render verbatim (e.g. "200/200" or the partial
 * "38/220" of a failed job); durations are presentational mm:ss conversions.
 */
export function SparkJobsTable({
  jobs,
  loading,
  error,
  onRetry,
  className,
}: {
  jobs?: SparkJobRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const title = 'Spark Job Monitor'
  const subtitle = 'Cluster jobs on the sample platform — stages, cores and shuffle volume'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load Spark jobs." />
      </ChartCard>
    )
  }
  if (loading || !jobs) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (jobs.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No Spark jobs recorded in the operations window." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-auto dineiq-scrollbar"
    >
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Job</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Status</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Started</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Duration</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Stages</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Cores</th>
            <th scope="col" className="py-2 text-right font-semibold">Rows shuffled</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2 font-semibold text-foreground">{humanize(j.name)}</td>
              <td className="py-2 pr-2">
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize ${jobStatusClass(j.status, isLight)}`}
                >
                  {j.status}
                </span>
              </td>
              <td className="py-2 pr-2 font-mono text-[11px] text-muted">{formatRelative(j.startedAt)}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-muted">{formatDuration(j.durationSec)}</td>
              <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">{j.stages}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-muted">{formatInt(j.cores)}</td>
              <td className="data-value py-2 text-right text-[11px] text-muted">{formatInt(j.rowsShuffled)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
