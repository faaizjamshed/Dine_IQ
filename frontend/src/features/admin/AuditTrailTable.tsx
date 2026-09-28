import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatRelative, humanize } from '@/lib/formatters'
import type { AuditEvent } from '@/api/types'

/**
 * AuditTrailTable — who did what on the platform from
 * GET /api/system/evidence → auditTrail (user, role, action, target, at).
 * Actions stay mono verbatim ("recommendation.acknowledge"); roles are
 * humanized for display only. Newest-first order comes from the API.
 */
export function AuditTrailTable({
  events,
  loading,
  error,
  onRetry,
  className,
}: {
  events?: AuditEvent[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Audit Trail'
  const subtitle = 'Recent privileged actions across the workspace'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load the audit trail." />
      </ChartCard>
    )
  }
  if (loading || !events) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
      </ChartCard>
    )
  }
  if (events.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No audit events recorded in this window." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-80 overflow-y-auto dineiq-scrollbar"
    >
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-2 font-semibold">User</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Role</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Action</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Target</th>
            <th scope="col" className="py-2 text-right font-semibold">When</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-border/60 text-xs">
              <td className="py-2 pr-2 font-semibold text-foreground">{e.user}</td>
              <td className="py-2 pr-2 text-muted">{humanize(e.role)}</td>
              <td className="py-2 pr-2 font-mono text-[11px] text-muted">{e.action}</td>
              <td className="py-2 pr-2 font-mono text-[11px] text-muted">{e.target}</td>
              <td className="py-2 text-right font-mono text-[11px] text-subtle">{formatRelative(e.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
