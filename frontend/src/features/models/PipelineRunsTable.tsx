import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { useTheme } from '@/components/layout/theme'
import { formatInt, formatRelative, humanize } from '@/lib/formatters'
import type { Pipeline, PipelineRun } from '@/api/types'

/**
 * Presentational duration arithmetic from the API's durationSec — "4m 24s".
 * This is display-only formatting of an API-supplied number; it never feeds
 * back into any data or calculation.
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

/**
 * Theme-aware pipeline tint — Spark = violet, Python = sky (dual-pipeline
 * color coding). Two shade sets keep contrast in both light and dark themes.
 */
function pipelineBadgeClass(pipeline: Pipeline, isLight: boolean): string {
  return pipeline === 'spark'
    ? isLight
      ? 'bg-violet-600/10 text-violet-700'
      : 'bg-violet-400/15 text-violet-300'
    : isLight
      ? 'bg-sky-600/10 text-sky-700'
      : 'bg-sky-400/15 text-sky-300'
}

/** Theme-aware run-status tint — success positive, failed critical, running sky. */
function runStatusClass(status: PipelineRun['status'], isLight: boolean): string {
  switch (status) {
    case 'unknown': return 'bg-surface-strong text-muted'
    case 'success':
      return 'bg-positive/15 text-positive'
    case 'failed':
      return 'bg-critical/15 text-critical'
    case 'running':
      return isLight ? 'bg-sky-600/10 text-sky-700' : 'bg-sky-400/15 text-sky-300'
  }
}

/**
 * PipelineRunsTable — recent Spark/Python job history from
 * GET /api/ml/demand-comparison → recentRuns (id, jobName, pipeline, startedAt,
 * durationSec, rowsIn, rowsOut, status). Job names are humanized for display
 * only; Run IDs stay mono verbatim. Durations are presentational mm:ss
 * conversions of durationSec.
 */
export function PipelineRunsTable({
  runs,
  loading,
  error,
  onRetry,
  className,
}: {
  runs?: PipelineRun[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const title = 'Recent Pipeline Runs'
  const subtitle = 'Latest jobs across both engines — failure history included'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load pipeline runs." />
      </ChartCard>
    )
  }
  if (loading || !runs) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (runs.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No pipeline runs recorded in the audit window." />
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
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Run ID</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Job</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Pipeline</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Started</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Duration</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">Rows in / out</th>
            <th scope="col" className="py-2 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2 font-mono text-[11px] text-foreground">{r.id}</td>
              <td className="py-2 pr-2 text-muted">{humanize(r.jobName)}</td>
              <td className="py-2 pr-2">
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize ${pipelineBadgeClass(r.pipeline, isLight)}`}
                >
                  {r.pipeline}
                </span>
              </td>
              <td className="py-2 pr-2 font-mono text-[11px] text-muted">{formatRelative(r.startedAt)}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-muted">{formatDuration(r.durationSec)}</td>
              <td className="data-value py-2 pr-2 text-right text-[11px] text-muted">
                {formatInt(r.rowsIn)} / {formatInt(r.rowsOut)}
              </td>
              <td className="py-2 text-right">
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize ${runStatusClass(r.status, isLight)}`}
                >
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
