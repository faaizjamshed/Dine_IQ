import { ArrowRight } from 'lucide-react'
import { RecommendationCard } from '@/components/insights'
import { ApiErrorState, NoDataState } from '@/components/errors/states'
import { Skeleton } from '@/components/ui/skeleton'
import type { Recommendation } from '@/api/types'

/**
 * CriticalRecommendations — priority-ordered action cards on the dashboard
 * (spec §24). The dashboard requests priority=critical from
 * GET /api/intelligence/recommendations and renders cards verbatim; cards without
 * evidence are dropped by RecommendationCard itself.
 */
export function CriticalRecommendations({
  recommendations,
  loading,
  error,
  onRetry,
  onViewAll,
}: {
  recommendations?: Recommendation[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  onViewAll?: () => void
}) {
  return (
    <section aria-labelledby="critical-recs-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="critical-recs-heading" className="text-sm font-bold tracking-tight text-foreground">
          Recommendations
          <span className="ml-2 font-mono text-[10px] font-normal text-subtle">
            Historical evidence · priority unavailable
          </span>
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
          >
            Full engine <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {loading && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && error ? <ApiErrorState error={error} retry={onRetry} /> : null}

      {!loading && !error && (!recommendations || recommendations.length === 0) && (
        <NoDataState message="No critical recommendations in the current period." hint="The engine may be operating within tolerance for this scope." />
      )}

      {!loading && !error && recommendations && recommendations.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recommendations.slice(0, 6).map((rec) => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>
      )}
    </section>
  )
}
