import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchRecommendations, updateRecommendationStatus } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { useAuth } from '@/features/auth/AuthProvider'
import { ApiErrorState, NoDataState } from '@/components/errors/states'
import { InsightStrip } from '@/components/insights'
import { RecommendationCard } from '@/components/insights/RecommendationCard'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Recommendation, RecommendationPriority } from '@/api/types'
import { cn } from '@/lib/utils'

const PRIORITIES: { value: string; label: string; dot?: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical', dot: 'bg-critical' },
  { value: 'high', label: 'High', dot: 'bg-high' },
  { value: 'medium', label: 'Medium', dot: 'bg-medium' },
  { value: 'low', label: 'Low', dot: 'bg-low' },
]

const STATUSES = ['all', 'new', 'acknowledged', 'dismissed'] as const

function RecCardSkeleton() {
  return (
    <div className="glass-card flex flex-col gap-3 p-4" aria-busy="true">
      <div className="flex gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/**
 * Recommendations page (spec §26) — every evidence-backed action from the
 * recommendation engine, filterable by priority and status.
 *
 * Behavior:
 *  - priority + status live in the URL (?priority=critical&status=new) so a
 *    filtered view is shareable — they are page-level params, distinct from
 *    the global scope filters.
 *  - Acknowledge / dismiss / reopen are API mutations (POST …/status) and
 *    appear only for roles holding recommendations.manage; the card guard
 *    still drops any recommendation the API ships without evidence.
 *  - Ordering is preserved exactly as the backend ranks it — the frontend
 *    never re-ranks recommendations.
 *
 * Data: GET /api/intelligence/recommendations, POST /api/intelligence/recommendations/{id}/status.
 */
export function RecommendationsPage() {
  const { filters } = useFilters()
  const { hasPermission } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const priority = searchParams.get('priority') ?? 'all'
  const status = searchParams.get('status') ?? 'all'
  const canManage = hasPermission('recommendations.manage')

  const [pendingId, setPendingId] = React.useState<string | null>(null)

  const query = useQuery({
    queryKey: queryKeys.recommendations({ ...filters, priority, status }),
    queryFn: () => fetchRecommendations({ ...filters, priority, status }, authHeaders()),
    staleTime: STALE_TIME.feed,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'acknowledged' | 'dismissed' | 'new' }) =>
      updateRecommendationStatus(id, next, authHeaders()),
    onMutate: ({ id }) => setPendingId(id),
    onSettled: () => setPendingId(null),
    onSuccess: () => {
      // Status affects both the list and any status filter — refetch.
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const setParam = (key: 'priority' | 'status', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: false })
  }

  const recommendations: Recommendation[] | undefined = query.data?.data.recommendations
  const meta = query.data?.meta
  const model =
    meta?.modelName && meta?.modelVersion && meta?.generatedAt && meta?.pipeline
      ? {
          name: meta.modelName,
          version: meta.modelVersion,
          generatedAt: meta.generatedAt,
          pipeline: meta.pipeline,
        }
      : undefined

  return (
    <div className="flex flex-col gap-4">
      {meta?.note && <p className="text-xs text-muted">{meta.note}</p>}
      <InsightStrip
        insight={query.data?.insight}
        source="GET /api/intelligence/recommendations"
        generatedAt={meta?.generatedAt}
        loading={query.isLoading}
      />

      {/* Page-level filter bar: priority chips + status tabs (both URL-persisted) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by priority"
        >
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setParam('priority', p.value)}
              aria-pressed={priority === p.value}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                priority === p.value
                  ? 'border-primary/40 bg-primary/12 text-foreground'
                  : 'border-border text-muted hover:bg-surface-strong hover:text-foreground',
              )}
            >
              {p.dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', p.dot)} />}
              {p.label}
            </button>
          ))}
        </div>

        <Tabs value={status} onValueChange={(v) => setParam('status', v)}>
          <TabsList aria-label="Filter by status">
            {STATUSES.map((s) => (
              <TabsTrigger key={s} value={s} disabled={s !== 'all'} title="Review status is unavailable" className="text-xs capitalize">
                {s}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Result count + model attribution */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] text-muted">
          {query.isLoading
            ? 'Loading recommendations…'
            : `${recommendations?.length ?? 0} recommendation${recommendations?.length === 1 ? '' : 's'} · historical evidence`}
          {query.isFetching && !query.isLoading && <span className="ml-2 text-primary">refreshing…</span>}
        </p>
        <ModelMetadata model={model} dense />
      </div>

      {/* Cards */}
      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.isLoading || recommendations === undefined ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RecCardSkeleton key={i} />
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <NoDataState
          message="No recommendations match the current priority, status and scope filters."
          hint="Widen the filters to see more of the engine's open actions."
        />
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              pendingStatus={pendingId === rec.id ? rec.status : null}
              onStatusChange={
                canManage
                  ? (next) => statusMutation.mutate({ id: rec.id, next })
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {!canManage && (
        <p className="font-mono text-[10px] text-subtle">
          Review status updates are unavailable in the existing backend.
        </p>
      )}
    </div>
  )
}

function authHeaders() {
  const token = getToken()
  return { Authorization: token ? `Bearer ${token}` : '' }
}
