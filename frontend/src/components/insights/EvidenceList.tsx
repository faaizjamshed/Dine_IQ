import { Table2 } from 'lucide-react'
import type { EvidenceItem } from '@/api/types'

/**
 * EvidenceList — renders API-supplied evidence rows (metric / value / detail).
 * Used by InsightStrip, RecommendationCard and AnomalyCard so the
 * "show your evidence" contract has one consistent presentation (spec §15/§34).
 */
export function EvidenceList({
  evidence,
  compact = false,
  className,
}: {
  evidence?: EvidenceItem[]
  compact?: boolean
  className?: string
}) {
  if (!evidence || evidence.length === 0) return null

  return (
    <ul className={className ?? 'flex flex-col gap-1.5'}>
      {evidence.map((item, idx) => (
        <li key={`${item.metric}-${idx}`} className="flex items-baseline gap-2 text-xs">
          <Table2 className="h-3 w-3 shrink-0 translate-y-0.5 text-subtle" aria-hidden />
          <span className="shrink-0 font-medium text-muted">{item.metric}</span>
          <span className="shrink-0 font-mono font-semibold text-foreground">{item.value}</span>
          {item.detail && !compact && (
            <span className="truncate text-[11px] text-subtle">{item.detail}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
