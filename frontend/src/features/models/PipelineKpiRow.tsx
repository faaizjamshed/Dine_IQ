import { Skeleton } from '@/components/ui/skeleton'
import { formatInt, formatPct, formatRelative, formatDateTime } from '@/lib/formatters'
import type { ModelComparisonData } from '@/api/types'

type PipelineKpis = ModelComparisonData['kpis']

/** Small stat card for the pipeline KPI strip — mirrors the shared KPI card language; `accent` tints the value. */
function PipelineStatCard({
  label,
  value,
  context,
  accent,
  big,
}: {
  label: string
  value: string
  context?: string
  accent?: string
  big?: boolean
}) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span
        className={`data-value font-bold leading-none ${big ? 'text-2xl' : 'text-xl'} ${accent ?? 'text-foreground'}`}
      >
        {value}
      </span>
      {context && <span className="text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function PipelineKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * PipelineKpiRow — the five parity-audit KPIs from
 * GET /api/ml/demand-comparison → kpis (agreementPct, sparkJobs, pythonJobs,
 * recordsCompared, lastComparedAt). Every value is rendered through the
 * shared formatters — no client-side aggregation. Record agreement carries
 * the positive accent (the headline trust metric of the audit).
 */
export function PipelineKpiRow({ kpis }: { kpis: PipelineKpis }) {
  return (
    <section
      aria-label="Pipeline parity KPIs"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
    >
      <PipelineStatCard
        label="Record agreement"
        value={formatPct(kpis.agreementPct)}
        context="Spark vs Python record diffs"
        accent="text-positive"
        big
      />
      <PipelineStatCard label="Spark jobs (24h)" value={formatInt(kpis.sparkJobs)} context="Distributed engine" />
      <PipelineStatCard label="Python jobs (24h)" value={formatInt(kpis.pythonJobs)} context="Single-node engine" />
      <PipelineStatCard
        label="Records compared"
        value={formatInt(kpis.recordsCompared)}
        context="Across all audit tables"
      />
      <PipelineStatCard
        label="Last compared"
        value={formatRelative(kpis.lastComparedAt)}
        context={formatDateTime(kpis.lastComparedAt)}
      />
    </section>
  )
}
