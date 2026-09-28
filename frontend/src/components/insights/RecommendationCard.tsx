import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Check, Clock, Sparkles, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DishThumb } from '@/components/ui/dish-thumb'
import { EvidenceList } from './EvidenceList'
import { humanize, formatRelative } from '@/lib/formatters'
import type { Recommendation, RecommendationPriority } from '@/api/types'
import { cn } from '@/lib/utils'

const PRIORITY_VARIANT: Record<
  RecommendationPriority,
  'critical' | 'high' | 'medium' | 'low' | 'neutral'
> = {
  unranked: 'neutral',
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
}

/**
 * RecommendationCard — the atomic unit of the recommendation engine (spec §34).
 *
 * Renders: Action · Priority · Estimated Impact (optional, only if the API
 * supplies it) · Evidence (mandatory).
 *
 * HARD RULE: a recommendation without evidence is never rendered. The guard
 * lives in the component itself so every consumer inherits it.
 *
 * Phase 2: optional status actions (acknowledge / dismiss / reopen). They
 * appear ONLY when the caller supplies `onStatusChange` AND the user holds
 * recommendations.manage — otherwise the card stays read-only (dashboard).
 */
export function RecommendationCard({
  recommendation,
  onStatusChange,
  pendingStatus,
  className,
}: {
  recommendation: Recommendation
  /** Present when the current role may manage recommendation status. */
  onStatusChange?: (status: 'acknowledged' | 'dismissed' | 'new') => void
  /** Status currently being persisted — used to disable the matching action. */
  pendingStatus?: Recommendation['status'] | null
  className?: string
}) {
  // Integrity guard — no evidence, no render.
  if (!recommendation.evidence || recommendation.evidence.length === 0) return null

  const isCritical = recommendation.priority === 'critical'
  const impact = recommendation.estimatedImpact
  const actionable = Boolean(onStatusChange)

  return (
    <article
      className={cn(
        'glass-card flex flex-col gap-3 p-4 transition-colors hover:border-border-strong',
        isCritical && 'border-critical/30',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {recommendation.itemId && recommendation.entityLabel && (
          <DishThumb itemId={recommendation.itemId} name={recommendation.entityLabel} size="sm" />
        )}
        <Badge variant={PRIORITY_VARIANT[recommendation.priority]}>
          {isCritical && (
            <span aria-hidden className="priority-critical-dot inline-block h-1.5 w-1.5 rounded-full bg-critical" />
          )}
          {recommendation.priority}
        </Badge>
        <Badge variant="outline">{humanize(recommendation.type)}</Badge>
        {recommendation.entityLabel && (
          <span className="truncate text-xs font-medium text-muted">{recommendation.entityLabel}</span>
        )}
      </div>

      <p className="text-sm font-medium leading-relaxed text-foreground">{recommendation.action}</p>

      {impact && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-strong px-2.5 py-1.5 text-xs">
          {impact.direction === 'increase' ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-positive" aria-hidden />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5 text-negative" aria-hidden />
          )}
          <span className="font-medium text-muted">{impact.metric}:</span>
          <span className="font-mono font-bold text-foreground">{impact.estimate}</span>
          <span className="text-[10px] uppercase tracking-wide text-subtle">estimated</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-subtle">
          <Sparkles className="h-3 w-3" aria-hidden /> Evidence
        </span>
        <EvidenceList evidence={recommendation.evidence} />
      </div>

      {actionable && onStatusChange && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          {recommendation.status === 'new' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={pendingStatus != null}
                onClick={() => onStatusChange('acknowledged')}
              >
                <Check className="h-3.5 w-3.5" aria-hidden /> Acknowledge
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted hover:text-foreground"
                disabled={pendingStatus != null}
                onClick={() => onStatusChange('dismissed')}
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Dismiss
              </Button>
            </>
          )}
          {recommendation.status !== 'new' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted hover:text-foreground"
              disabled={pendingStatus != null}
              onClick={() => onStatusChange('new')}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Reopen
            </Button>
          )}
          {pendingStatus === recommendation.status && (
            <span className="font-mono text-[10px] text-subtle">saving…</span>
          )}
        </div>
      )}

      <p className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] text-subtle">
        <Clock className="h-3 w-3" aria-hidden />
        {formatRelative(recommendation.createdAt)} · {humanize(recommendation.status)}
      </p>
    </article>
  )
}
