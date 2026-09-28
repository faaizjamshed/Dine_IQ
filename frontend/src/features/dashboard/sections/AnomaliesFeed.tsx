import { ArrowRight } from 'lucide-react'
import { AnomalyCard } from '@/components/insights'
import { ApiErrorState, NoDataState } from '@/components/errors/states'
import { Skeleton } from '@/components/ui/skeleton'
import type { Anomaly } from '@/api/types'

/**
 * AnomaliesFeed — latest detections with severity + evidence (spec §24).
 * Data: GET /api/intelligence/anomalies (limit applied server-side by the adapter/backend).
 */
export function AnomaliesFeed({
  anomalies,
  loading,
  error,
  onRetry,
  onViewAll,
}: {
  anomalies?: Anomaly[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  onViewAll?: () => void
}) {
  return (
    <section aria-labelledby="anomalies-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="anomalies-heading" className="text-sm font-bold tracking-tight text-foreground">
          Anomaly Feed
          <span className="ml-2 font-mono text-[10px] font-normal text-subtle">
            GET /api/intelligence/anomalies · severity-ordered
          </span>
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
          >
            Full timeline <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {loading && (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && error ? <ApiErrorState error={error} retry={onRetry} /> : null}

      {!loading && !error && (!anomalies || anomalies.length === 0) && (
        <NoDataState message="No anomalies were detected in this period." hint="Detection pipelines ran without findings for the current scope." />
      )}

      {!loading && !error && anomalies && anomalies.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {anomalies.map((anomaly) => (
            <AnomalyCard key={anomaly.id} anomaly={anomaly} />
          ))}
        </div>
      )}
    </section>
  )
}
