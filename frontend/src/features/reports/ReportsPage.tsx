import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, getToken } from '@/api/client'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchReportsCatalog, runReport } from '@/api/endpoints'
import { ApiErrorState, NoDataState } from '@/components/errors/states'
import { Skeleton } from '@/components/ui/skeleton'
import { useFilters } from '@/hooks/useFilters'
import { useAuth } from '@/features/auth/AuthProvider'
import { ReportCatalog } from './ReportCatalog'
import { ExportResultCard } from './ExportResultCard'
import type { ReportDef, ReportRunResponse } from '@/api/types'

/**
 * Reports & Export page (spec — Phase 5) — the report catalog plus the
 * post-run export result (preview + CSV download).
 *
 * Data:
 *  - GET  /api/reports/catalog (long-lived reference query, no filters).
 *  - POST /api/reports/{id}/run via mutation — the export HONORS the global
 *    scope: the filters from useFilters() ride in the request body, so the
 *    sampled rows reflect the top-bar filter selection.
 *
 * The run button is permission-gated per report (requiresPermission); the
 * backend remains the authoritative enforcement layer.
 */
export function ReportsPage() {
  const { filters } = useFilters()
  const { hasPermission } = useAuth()
  const token = getToken()
  const auth = { Authorization: token ? `Bearer ${token}` : '' }

  const catalog = useQuery({
    queryKey: queryKeys.reports(),
    queryFn: () => fetchReportsCatalog(auth),
    staleTime: STALE_TIME.reference,
  })

  const [lastResult, setLastResult] = React.useState<ReportRunResponse['data'] | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  const runMutation = useMutation({
    mutationFn: (report: ReportDef) => runReport(report.id, filters, auth),
    onMutate: (report) => setPendingId(report.id),
    onSuccess: (res) => setLastResult(res.data),
    onSettled: () => setPendingId(null),
  })

  const handleRun = (report: ReportDef) => {
    if (!hasPermission(report.requiresPermission)) return
    runMutation.mutate(report)
  }

  const reports = catalog.data?.data.reports
  const reportName = reports?.find((r) => r.id === lastResult?.reportId)?.name
  const runError = runMutation.error

  return (
    <div className="flex flex-col gap-4">
      {/* UI copy describing export behavior — allowed, not an API insight. */}
      <p className="text-xs leading-relaxed text-muted">
        Reports use the full historical dataset and include at most 1000 rows. Reset global filters before running a report.
      </p>

      {catalog.error ? (
        <ApiErrorState error={catalog.error} retry={() => void catalog.refetch()} />
      ) : reports && reports.length === 0 ? (
        <NoDataState message="No reports are registered for export yet." />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            {catalog.isLoading || !reports ? (
              <div className="glass-card flex flex-col gap-3 p-5">
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-44 rounded-2xl" />
                  ))}
                </div>
              </div>
            ) : (
              <ReportCatalog
                reports={reports}
                loading={catalog.isLoading}
                error={catalog.error}
                onRetry={() => void catalog.refetch()}
                pendingId={pendingId}
                onRun={handleRun}
              />
            )}
          </div>

          <div className="flex flex-col gap-3 xl:sticky xl:top-2 xl:self-start">
            {runError && (
              <div
                role="alert"
                className="rounded-xl border border-critical/30 bg-critical/5 px-3 py-2.5 text-xs leading-relaxed text-foreground"
              >
                <span className="font-bold text-critical">Export failed. </span>
                {runError instanceof ApiError
                  ? runError.message
                  : 'Unexpected error while running the report — retry.'}
              </div>
            )}

            {lastResult ? (
              <ExportResultCard
                result={lastResult}
                reportName={reportName}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                onDismiss={() => setLastResult(null)}
              />
            ) : (
              !runError && (
                <div className="glass-card flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
                  <p className="text-sm font-medium text-muted">No export run yet</p>
                  <p className="max-w-xs text-xs leading-relaxed text-subtle">
                    Run a report from the catalog to preview its sampled rows and download the CSV
                    here.
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
