import { Loader2, Lock, Play } from 'lucide-react'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/layout/theme'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatInt, formatRelative } from '@/lib/formatters'
import type { ReportDef } from '@/api/types'

/** Theme-aware export-format tint — csv sky, xlsx violet, readable in both themes. */
function formatBadgeClass(format: ReportDef['format'], isLight: boolean): string {
  return format === 'csv'
    ? isLight
      ? 'bg-sky-600/10 text-sky-700'
      : 'bg-sky-400/15 text-sky-300'
    : isLight
      ? 'bg-violet-600/10 text-violet-700'
      : 'bg-violet-400/15 text-violet-300'
}

/**
 * ReportCatalog — the exportable report catalog from
 * GET /api/reports/catalog → reports (id, name, description, format, rows,
 * lastGenerated, requiresPermission, scopeNote). Run buttons are disabled
 * with a "Requires {permission}" hint when the signed-in role lacks the
 * permission (UI convenience only — the backend stays authoritative). While
 * a run is in flight the pending card shows a spinner + "Running…" and all
 * other runs are blocked until it settles.
 */
export function ReportCatalog({
  reports,
  loading,
  error,
  onRetry,
  pendingId,
  onRun,
  className,
}: {
  reports?: ReportDef[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  pendingId: string | null
  onRun: (report: ReportDef) => void
  className?: string
}) {
  const { isLight } = useTheme()
  const { hasPermission } = useAuth()
  const title = 'Report Catalog'
  const subtitle = 'CSV / Excel-compatible exports generated from the analytics warehouse'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the report catalog." />
      </ChartCard>
    )
  }
  if (loading || !reports) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={320} />
      </ChartCard>
    )
  }
  if (reports.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No reports are registered for export yet." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      actions={<span className="font-mono text-[10px] text-subtle">{reports.length} reports</span>}
      contentClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {reports.map((r) => {
        const allowed = hasPermission(r.requiresPermission)
        const pending = pendingId === r.id
        return (
          <article key={r.id} className="glass-card flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-bold leading-snug text-foreground">{r.name}</h4>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${formatBadgeClass(r.format, isLight)}`}
              >
                {r.format}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted">{r.description}</p>
            <p className="font-mono text-[10px] text-subtle">
              {formatInt(r.rows)} rows · last generated {formatRelative(r.lastGenerated)}
            </p>
            <p className="text-[10px] leading-snug text-subtle">{r.scopeNote}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              {!allowed && (
                <span className="inline-flex items-center gap-1 text-[10px] text-subtle">
                  <Lock className="h-3 w-3" aria-hidden />
                  Requires <span className="font-mono">{r.requiresPermission}</span>
                </span>
              )}
              <span
                className={allowed ? 'ml-auto' : ''}
                title={allowed ? undefined : `Requires ${r.requiresPermission}`}
              >
                <Button
                  size="sm"
                  variant={allowed ? 'default' : 'secondary'}
                  disabled={!allowed || pendingId !== null}
                  onClick={() => onRun(r)}
                  aria-label={`Run report: ${r.name}`}
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Running…
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" aria-hidden />
                      Run
                    </>
                  )}
                </Button>
              </span>
            </div>
          </article>
        )
      })}
    </ChartCard>
  )
}
