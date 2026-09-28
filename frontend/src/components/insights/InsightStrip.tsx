import * as React from 'react'
import { Lightbulb, ShieldCheck } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { WhyItMatters } from './WhyItMatters'
import { formatDateTime } from '@/lib/formatters'
import type { Insight } from '@/api/types'

/**
 * InsightStrip — the mandatory opener for every major page (spec §15).
 *
 * Structure: INSIGHT overline → API-supplied summary sentences →
 * "Why it matters" popover → source attribution footer.
 *
 * Integrity guarantees:
 *  - If the API supplies no insight, the strip renders NOTHING (an
 *    unexplained insight may never appear).
 *  - Text is rendered verbatim; the frontend never generates interpretation.
 */
export function InsightStrip({
  insight,
  source,
  generatedAt,
  loading = false,
  className,
}: {
  insight?: Insight
  source: string
  generatedAt?: string
  loading?: boolean
  className?: string
}) {
  if (loading) {
    return (
      <div
        className={'glass-card flex flex-col gap-2 p-4 ' + (className ?? '')}
        aria-busy="true"
        aria-live="polite"
      >
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3.5 w-full max-w-3xl" />
        <Skeleton className="h-3.5 w-full max-w-xl" />
      </div>
    )
  }

  if (!insight || !insight.summary || insight.summary.length === 0) return null

  return (
    <section
      aria-label="Page insight"
      className={
        'glass-card relative overflow-hidden border-primary/20 p-4 ' + (className ?? '')
      }
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-primary-strong"
      />
      <div className="flex flex-col gap-2 pl-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="overline-label inline-flex items-center gap-1.5 text-primary">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden />
            Insight
          </span>
          <WhyItMatters insight={insight} />
        </div>

        <div className="flex flex-col gap-1">
          {insight.summary.map((sentence, i) => (
            <p key={i} className="text-sm leading-relaxed text-foreground">
              {sentence}
            </p>
          ))}
        </div>

        <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-subtle">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          <span>Source: {source}</span>
          {generatedAt && (
            <>
              <span aria-hidden>·</span>
              <span>Generated {formatDateTime(generatedAt)}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>Frontend displays API interpretation only</span>
        </p>
      </div>
    </section>
  )
}

/** Skeleton exported for pages that compose their own loading layout. */
export function InsightStripSkeleton({ className }: { className?: string }) {
  return (
    <div className={'glass-card flex flex-col gap-2 p-4 ' + (className ?? '')} aria-busy="true">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3.5 w-full max-w-3xl" />
      <Skeleton className="h-3.5 w-full max-w-xl" />
    </div>
  )
}
