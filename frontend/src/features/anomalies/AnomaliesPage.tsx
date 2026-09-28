import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchAnomalies, updateAnomalyStatus } from '@/api/endpoints'
import { useFilters } from '@/hooks/useFilters'
import { useAuth } from '@/features/auth/AuthProvider'
import { ApiErrorState, NoDataState } from '@/components/errors/states'
import { AnomalyCard } from '@/components/insights/AnomalyCard'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Anomaly, AnomalySeverity } from '@/api/types'
import { cn } from '@/lib/utils'

const SEVERITIES: { value: string; label: string; dot?: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical', dot: 'bg-critical' },
  { value: 'high', label: 'High', dot: 'bg-high' },
  { value: 'medium', label: 'Medium', dot: 'bg-medium' },
  { value: 'low', label: 'Low', dot: 'bg-low' },
]

const STATUSES = ['all', 'new', 'reviewing', 'resolved', 'dismissed'] as const

const SEVERITY_ORDER: AnomalySeverity[] = ['critical', 'high', 'medium', 'low', 'unranked']

/** Static severity → dot/bar color map (mirrors the chip dots above). */
const SEVERITY_BAR: Record<AnomalySeverity, string> = {
  unranked: 'bg-neutral',
  critical: 'bg-critical',
  high: 'bg-high',
  medium: 'bg-medium',
  low: 'bg-low',
}

function AnomalyCardSkeleton() {
  return (
    <div className="glass-card flex flex-col gap-3 p-4" aria-busy="true">
      <div className="flex gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-14 w-full" />
    </div>
  )
}

/**
 * SeverityDistributionStrip — tiny CSS bars with the count per severity.
 *
 * PRESENTATION-LEVEL COUNTING ONLY: the bars are computed from the rows the
 * API already shipped (the full ranked feed, before the local severity/
 * status narrowing) — the backend remains the source of truth for ranking
 * and scoring, and no business value is derived beyond tallying rows.
 */
function SeverityDistributionStrip({ anomalies }: { anomalies: Anomaly[] }) {
  const counts = new Map<AnomalySeverity, number>(SEVERITY_ORDER.map((s) => [s, 0]))
  for (const a of anomalies) counts.set(a.severity, (counts.get(a.severity) ?? 0) + 1)
  const max = Math.max(1, ...counts.values())

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      role="group"
      aria-label="Anomaly counts by severity"
    >
      {SEVERITY_ORDER.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_BAR[s])} />
          <span className="text-[11px] font-semibold capitalize text-muted">{s}</span>
          <span className="font-mono text-[11px] text-foreground">{counts.get(s)}</span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-strong" aria-hidden>
            <span
              className={cn('block h-full rounded-full', SEVERITY_BAR[s])}
              style={{ width: `${Math.max(4, ((counts.get(s) ?? 0) / max) * 100)}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Anomalies page (spec §33) — the detected-anomaly feed with review workflow.
 *
 * Behavior:
 *  - severity chips + status tabs persist to the URL (?severity=&status=).
 *    The backend contract returns the FULL ranked feed (severity then
 *    detection time); severity/status narrowing happens CLIENT-SIDE on that
 *    list — same presentation-level filtering as the menu class filter.
 *    Ranking itself is never recomputed client-side.
 *  - Review status changes (POST /api/intelligence/anomalies/{id}/status) appear only for
 *    roles holding recommendations.manage (admin/regional); the mock backend
 *    persists the overrides session-scoped and replays them on GET.
 *  - Integrity: the anomalies response carries NO insight, so no
 *    InsightStrip is rendered — the frontend never generates interpretation.
 *
 * Data: GET /api/intelligence/anomalies, POST /api/intelligence/anomalies/{id}/status.
 */
export function AnomaliesPage() {
  const { filters } = useFilters()
  const { hasPermission } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const severity = searchParams.get('severity') ?? 'all'
  const status = searchParams.get('status') ?? 'all'
  const canManage = hasPermission('recommendations.manage')

  const [pendingId, setPendingId] = React.useState<string | null>(null)

  // Full ranked feed — limit is deliberately undefined so the page sees
  // every anomaly the backend ships for the scope (the dashboard caps it).
  const query = useQuery({
    queryKey: queryKeys.anomalies({ ...filters, limit: undefined }),
    queryFn: () => fetchAnomalies({ ...filters, limit: undefined }, authHeaders()),
    staleTime: STALE_TIME.feed,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'new' | 'reviewing' | 'resolved' | 'dismissed' }) =>
      updateAnomalyStatus(id, next, authHeaders()),
    onMutate: ({ id }) => setPendingId(id),
    onSettled: () => setPendingId(null),
    onSuccess: () => {
      // Status affects the list, the status tabs and the distribution strip.
      void queryClient.invalidateQueries({ queryKey: ['anomalies'] })
    },
  })

  const setParam = (key: 'severity' | 'status', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: false })
  }

  const anomalies: Anomaly[] | undefined = query.data?.data.anomalies
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

  // Client-side narrowing of the historical evidence feed (URL-persisted).
  const visible = React.useMemo(() => {
    if (!anomalies) return []
    return anomalies.filter(
      (a) =>
        (severity === 'all' || a.severity === severity) &&
        (status === 'all' || a.status === status),
    )
  }, [anomalies, severity, status])

  return (
    <div className="flex flex-col gap-4">
      {meta?.note && <p className="text-xs text-muted">{meta.note}</p>}
      {/* Page-level filter bar: severity chips + status tabs (both URL-persisted) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by severity"
        >
          {SEVERITIES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setParam('severity', s.value)}
              aria-pressed={severity === s.value}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                severity === s.value
                  ? 'border-primary/40 bg-primary/12 text-foreground'
                  : 'border-border text-muted hover:bg-surface-strong hover:text-foreground',
              )}
            >
              {s.dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />}
              {s.label}
            </button>
          ))}
        </div>

        <Tabs value={status} onValueChange={(v) => setParam('status', v)}>
          <TabsList aria-label="Filter by review status">
            {STATUSES.map((s) => (
              <TabsTrigger key={s} value={s} disabled={s !== 'all'} title="Review status is unavailable" className="text-xs capitalize">
                {s}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Severity distribution — presentation-level tally of the fetched feed */}
      {anomalies && anomalies.length > 0 && <SeverityDistributionStrip anomalies={anomalies} />}

      {/* Result count + model attribution */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] text-muted">
          {query.isLoading
            ? 'Loading anomalies…'
            : `${visible.length} of ${anomalies?.length ?? 0} anomal${(anomalies?.length ?? 0) === 1 ? 'y' : 'ies'} · historical candidates; severity is unavailable`}
          {query.isFetching && !query.isLoading && <span className="ml-2 text-primary">refreshing…</span>}
        </p>
        <ModelMetadata model={model} dense />
      </div>

      {/* Cards */}
      {query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.isLoading || anomalies === undefined ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <AnomalyCardSkeleton key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <NoDataState message="No anomalies match the current severity and status filters." />
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((anomaly) => (
            <AnomalyCard
              key={anomaly.id}
              anomaly={anomaly}
              pendingStatus={pendingId === anomaly.id ? anomaly.status : null}
              onStatusChange={
                canManage
                  ? (next) => statusMutation.mutate({ id: anomaly.id, next })
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
