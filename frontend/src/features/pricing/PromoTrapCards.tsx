import { ChartCard, ChartSkeleton } from '@/components/charts'
import { EvidenceList } from '@/components/insights'
import { formatDelta } from '@/lib/formatters'
import type { PromoTrap } from '@/api/types'

/**
 * PromoTrapCards — items the promotions engine has flagged as structurally
 * dependent on discounts (GET /api/intelligence/pricing → promoTraps).
 *
 * The trap DEFINITIONS (dependency thresholds, evidence rows) come from the
 * promotions engine upstream; this component only lays them out: the big
 * promo-dependency share, the per-order profit change on promo days, and the
 * engine's evidence list rendered verbatim via the shared EvidenceList.
 */
export function PromoTrapCards({
  traps,
  loading,
  className,
}: {
  traps?: PromoTrap[]
  loading?: boolean
  className?: string
}) {
  const title = 'Promo Traps'
  const subtitle = 'Items selling below contribution margin on discount days — engine verdicts'

  if (loading || !traps) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={220} />
      </ChartCard>
    )
  }

  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      {traps.length === 0 ? (
        <p className="py-6 text-center text-xs text-subtle">
          No promo traps flagged for the selected scope.
        </p>
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {traps.map((trap) => (
            <article
              key={trap.itemId}
              className="flex flex-col gap-2 rounded-xl border border-critical/20 bg-critical/5 p-4"
              aria-label={`Promo trap: ${trap.name}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="truncate text-sm font-bold text-foreground">{trap.name}</h4>
                <span className="font-mono text-[10px] text-subtle">{trap.itemId}</span>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="flex flex-col">
                  <span className="data-value text-2xl font-bold leading-none text-foreground">
                    {trap.promoDependencyPct}%
                  </span>
                  <span className="mt-1 text-[10px] text-subtle">of volume sold on promotion</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="data-value text-lg font-bold leading-none text-negative">
                    {formatDelta(trap.profitOnPromoDaysPct)}
                  </span>
                  <span className="mt-1 text-[10px] text-subtle">profit per order on promo days</span>
                </div>
              </div>

              <EvidenceList evidence={trap.evidence} className="mt-1 flex flex-col gap-1" />
            </article>
          ))}
        </div>
      )}
    </ChartCard>
  )
}
