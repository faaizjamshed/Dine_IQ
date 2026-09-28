import * as React from 'react'
import { HelpCircle, Lightbulb, Target } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EvidenceList } from './EvidenceList'
import type { Insight } from '@/api/types'

/**
 * WhyItMatters — popover behind the InsightStrip's "Why it matters" action.
 * Contents are 100% API-supplied: supporting metrics, affected dimension,
 * evidence and the relevant period (spec §15). The popover renders only the
 * fields the API actually provides.
 */
export function WhyItMatters({ insight }: { insight: Insight }) {
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        aria-label="Why this insight matters"
      >
        Why it matters
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Target className="h-3.5 w-3.5" aria-hidden /> Business context
          </div>

          {insight.whyItMatters && (
            <p className="text-xs leading-relaxed text-foreground">{insight.whyItMatters}</p>
          )}

          {(insight.affectedDimension || insight.period) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-subtle">
              {insight.affectedDimension && (
                <span>
                  <span className="text-muted">Dimension:</span> {insight.affectedDimension}
                </span>
              )}
              {insight.period && (
                <span>
                  <span className="text-muted">Period:</span> {insight.period}
                </span>
              )}
            </div>
          )}

          {insight.evidence && insight.evidence.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-subtle">
                Supporting metrics
              </p>
              <EvidenceList evidence={insight.evidence} />
            </div>
          )}

          {insight.recommendedAction && (
            <div className="rounded-lg border border-primary/25 bg-primary/10 p-2.5">
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-semibold text-primary">Suggested next step: </span>
                  {insight.recommendedAction}
                </span>
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
