import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { useTheme } from '@/components/layout/theme'
import { formatDate } from '@/lib/formatters'
import type { ModelRegistryEntry, Pipeline } from '@/api/types'

/**
 * Theme-aware pipeline tint — Spark = violet, Python = sky, consistent with
 * the Model Comparison page's dual-pipeline color coding.
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

/** Registry lifecycle tint — production positive, staging sky, archived neutral. */
function registryStatusClass(status: ModelRegistryEntry['status'], isLight: boolean): string {
  switch (status) {
    case 'production':
      return 'bg-positive/15 text-positive'
    case 'staging':
      return isLight ? 'bg-sky-600/10 text-sky-700' : 'bg-sky-400/15 text-sky-300'
    case 'evidence':
    case 'archived':
      return 'bg-surface-strong text-muted'
  }
}

/**
 * ModelRegistryTable — the registered models from GET /api/system/evidence →
 * modelRegistry (name, version, pipeline, trainedAt, status, metrics).
 * Metric chips ("MAPE 8.4%") are inline mono spans rendered verbatim from
 * the API's name/value pairs — no derived scores.
 */
export function ModelRegistryTable({
  models,
  loading,
  error,
  onRetry,
  className,
}: {
  models?: ModelRegistryEntry[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const title = 'Model Registry'
  const subtitle = 'Registered models with training dates and evaluation metrics'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the model registry." />
      </ChartCard>
    )
  }
  if (loading || !models) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (models.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No models registered on this platform." />
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
      <table className="w-full min-w-[620px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">Model</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Version</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Pipeline</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Trained</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Status</th>
            <th scope="col" className="py-2 font-semibold">Metrics</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={`${m.name}-${m.version}`} className="border-t border-border/60 align-top text-xs">
              <td className="py-2.5 pr-2 font-semibold text-foreground">{m.name}</td>
              <td className="py-2.5 pr-2 font-mono text-[11px] text-muted">v{m.version}</td>
              <td className="py-2.5 pr-2">
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize ${pipelineBadgeClass(m.pipeline, isLight)}`}
                >
                  {m.pipeline}
                </span>
              </td>
              <td className="py-2.5 pr-2 font-mono text-[11px] text-muted">{formatDate(m.trainedAt)}</td>
              <td className="py-2.5 pr-2">
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize ${registryStatusClass(m.status, isLight)}`}
                >
                  {m.status}
                </span>
              </td>
              <td className="py-2.5">
                <span className="flex flex-wrap gap-1">
                  {m.metrics.map((metric) => (
                    <span
                      key={metric.name}
                      className="inline-block whitespace-nowrap rounded bg-surface-strong px-1.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      {metric.name} {metric.value}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
