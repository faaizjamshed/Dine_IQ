import * as React from 'react'
import { Activity, Check, Clock, Eye, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EvidenceList } from './EvidenceList'
import { humanize, formatDateTime } from '@/lib/formatters'
import type { Anomaly, AnomalySeverity } from '@/api/types'
import { cn } from '@/lib/utils'

const SEVERITY_VARIANT: Record<AnomalySeverity, 'critical' | 'high' | 'medium' | 'low' | 'neutral'> = {
  unranked: 'neutral',
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
}

/**
 * AnomalyCard — renders one detected anomaly with severity, affected
 * dimension, detection method (optional), evidence and review status
 * (spec §33). Statuses displayed are exactly the API-supplied values.
 *
 * Phase 4: optional status actions (start reviewing / resolve / dismiss /
 * reopen). They appear ONLY when the caller supplies `onStatusChange` —
 * mirroring RecommendationCard, the dashboard passes neither optional prop
 * and the card stays read-only. While a status change is in flight the
 * caller passes `pendingStatus` (non-null) and every action disables to
 * prevent double submits; a "saving…" hint shows on the affected card.
 */
export function AnomalyCard({
  anomaly,
  compact = false,
  onStatusChange,
  pendingStatus,
  className,
}: {
  anomaly: Anomaly
  compact?: boolean
  /** Present when the current role may manage anomaly review status. */
  onStatusChange?: (status: 'new' | 'reviewing' | 'resolved' | 'dismissed') => void
  /** Status currently being persisted — used to disable the matching action. */
  pendingStatus?: Anomaly['status'] | null
  className?: string
}) {
  const isCritical = anomaly.severity === 'critical'
  const actionable = Boolean(onStatusChange)

  return (
    <article
      className={cn(
        'glass-card flex flex-col gap-2.5 p-4 transition-colors hover:border-border-strong',
        isCritical && 'border-critical/30',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[anomaly.severity]}>
          {isCritical && (
            <span aria-hidden className="priority-critical-dot inline-block h-1.5 w-1.5 rounded-full bg-critical" />
          )}
          {anomaly.severity}
        </Badge>
        <Badge variant="outline">{humanize(anomaly.type)}</Badge>
        <span className="font-mono text-[10px] text-subtle">
          {formatDateTime(anomaly.detectedAt)}
        </span>
      </div>

      <p className="text-sm font-medium leading-relaxed text-foreground">{anomaly.summary}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-subtle">
        <span>
          <span className="text-muted">Dimension:</span> {humanize(anomaly.dimension)}
          {anomaly.dimensionRef ? ` · ${anomaly.dimensionRef}` : ''}
        </span>
        {anomaly.detectionMethod && (
          <span className="inline-flex items-center gap-1">
            <Activity className="h-3 w-3" aria-hidden />
            {anomaly.detectionMethod}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          Status: {humanize(anomaly.status)}
        </span>
      </div>

      {!compact && <EvidenceList evidence={anomaly.evidence} className="border-t border-border pt-2.5" />}

      {actionable && onStatusChange && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          {anomaly.status === 'new' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={pendingStatus != null}
              onClick={() => onStatusChange('reviewing')}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden /> Start reviewing
            </Button>
          )}
          {anomaly.status === 'reviewing' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={pendingStatus != null}
              onClick={() => onStatusChange('resolved')}
            >
              <Check className="h-3.5 w-3.5" aria-hidden /> Resolve
            </Button>
          )}
          {(anomaly.status === 'new' || anomaly.status === 'reviewing') && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={pendingStatus != null}
              onClick={() => onStatusChange('dismissed')}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Dismiss
            </Button>
          )}
          {(anomaly.status === 'resolved' || anomaly.status === 'dismissed') && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={pendingStatus != null}
              onClick={() => onStatusChange('new')}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Reopen
            </Button>
          )}
          {pendingStatus === anomaly.status && (
            <span className="font-mono text-[10px] text-subtle">saving…</span>
          )}
        </div>
      )}
    </article>
  )
}
