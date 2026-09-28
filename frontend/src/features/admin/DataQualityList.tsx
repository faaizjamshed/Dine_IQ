import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatRelative } from '@/lib/formatters'
import type { DataQualityCheck } from '@/api/types'

/** Status tint per the severity ladder — fail critical, warn medium, pass positive. */
const DQ_STATUS_CLASS: Record<DataQualityCheck['status'], string> = {
  fail: 'bg-critical/15 text-critical',
  warn: 'bg-medium/15 text-medium',
  pass: 'bg-positive/15 text-positive',
}

/** Visual grouping order: problems first (fail → warn → pass). */
const STATUS_ORDER: DataQualityCheck['status'][] = ['fail', 'warn', 'pass']

const STATUS_GROUP_LABEL: Record<DataQualityCheck['status'], string> = {
  fail: 'Failing checks',
  warn: 'Warnings',
  pass: 'Passing checks',
}

/**
 * DataQualityList — ingestion quality checks from GET /api/system/evidence →
 * dataQuality (table, check, status, detail, lastRun), grouped visually by
 * status order fail → warn → pass. Details render verbatim. Fail/warn rows
 * map to anomalies surfaced on the Anomalies page (e.g. dq-03 → anm-002), so
 * data issues stay auditable end to end.
 */
export function DataQualityList({
  checks,
  loading,
  error,
  onRetry,
  className,
}: {
  checks?: DataQualityCheck[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Data Quality Checks'
  const subtitle = 'Ingestion gate per cycle — fail/warn items map to the Anomalies page'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load data quality checks." />
      </ChartCard>
    )
  }
  if (loading || !checks) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (checks.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No quality checks registered for this platform." />
      </ChartCard>
    )
  }

  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: checks.filter((c) => c.status === status),
  })).filter((g) => g.rows.length > 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <span className="font-mono text-[10px] text-subtle">{checks.length} checks / cycle</span>
      }
      contentClassName="max-h-96 overflow-y-auto dineiq-scrollbar"
    >
      <div className="flex flex-col gap-4" role="list" aria-label="Data quality checks by status">
        {groups.map((group) => (
          <section key={group.status} className="flex flex-col gap-1.5">
            <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-subtle">
              <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DQ_STATUS_CLASS[group.status].split(' ')[0]}`} />
              {STATUS_GROUP_LABEL[group.status]}
              <span className="font-mono normal-case text-subtle">({group.rows.length})</span>
            </h4>
            <ul className="flex flex-col">
              {group.rows.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 border-t border-border/60 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${DQ_STATUS_CLASS[c.status]}`}
                    >
                      {c.status}
                    </span>
                    <span className="font-mono text-[11px] text-muted">{c.table}</span>
                    <span className="text-xs font-semibold text-foreground">{c.check}</span>
                    <span className="ml-auto font-mono text-[10px] text-subtle">{formatRelative(c.lastRun)}</span>
                  </div>
                  <p className="text-[10px] leading-snug text-subtle">{c.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ChartCard>
  )
}
