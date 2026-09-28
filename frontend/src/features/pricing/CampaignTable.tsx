import { formatDecimal } from '@/lib/formatters'
import { ChartCard, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatInt, formatPct, formatDelta, humanize } from '@/lib/formatters'
import type { PromoCampaign } from '@/api/types'
import { cn } from '@/lib/utils'

/**
 * Status badge — sky tint while a campaign is running, slate once it has
 * completed. Sky comes from the shared chart theme so it follows the active
 * theme exactly like every other chart element.
 */
function StatusBadge({ status }: { status: PromoCampaign['status'] }) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  if (status === 'active') {
    return (
      <span
        className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize"
        style={{ backgroundColor: `${theme.series.sky}22`, color: theme.series.sky }}
      >
        {status}
      </span>
    )
  }
  return (
    <span className="inline-block rounded-md bg-low/15 px-1.5 py-0.5 text-[10px] font-bold capitalize text-low">
      {status}
    </span>
  )
}

const VERDICT_BADGE: Record<PromoCampaign['verdict'], string> = {
  unavailable: 'bg-surface-strong text-muted',
  scale: 'bg-positive/15 text-positive',
  optimize: 'bg-primary/15 text-primary',
  retire: 'bg-critical/15 text-critical',
}

/**
 * CampaignTable — promotion performance ledger
 * (GET /api/intelligence/pricing → campaigns). Every cell is API-supplied: the
 * window string is rendered verbatim, incremental revenue is the engine's
 * incrementality estimate, and the ROI/verdict verdicts come from the
 * promotions engine — the frontend adds no derived columns.
 */
export function CampaignTable({
  campaigns,
  loading,
  className,
}: {
  campaigns?: PromoCampaign[]
  loading?: boolean
  className?: string
}) {
  const title = 'Campaign Performance'
  const subtitle = 'Incrementality and verdicts from the promotions engine'

  if (loading || !campaigns) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={280} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-auto dineiq-scrollbar"
    >
      {campaigns.length === 0 ? (
        <p className="py-6 text-center text-xs text-subtle">No campaigns in the API response.</p>
      ) : (
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wide text-subtle">
              <th scope="col" className="py-2 pr-2 font-semibold">Campaign</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Channel</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Window</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">Disc.</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">Orders</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">Revenue</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">Incr. revenue</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">ROI</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">Margin impact</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Status</th>
              <th scope="col" className="py-2 text-right font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t border-border/60 text-xs">
                <td className="py-2 pr-2 font-medium text-foreground">{c.name}</td>
                <td className="py-2 pr-2 text-muted">{humanize(c.channel)}</td>
                <td className="py-2 pr-2 whitespace-nowrap font-mono text-[11px] text-muted">{c.window}</td>
                <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                  {formatPct(c.discountPct, 0)}
                </td>
                <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                  {formatInt(c.orders)}
                </td>
                <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                  {formatPKR(c.revenue, { compact: true })}
                </td>
                <td
                  className={cn(
                    'py-2 pr-2 text-right font-mono text-[11px] font-semibold',
                    c.incrementalRevenue < 0 ? 'text-negative' : 'text-foreground',
                  )}
                >
                  {formatPKR(c.incrementalRevenue, { compact: true })}
                </td>
                <td
                  className={cn(
                    'py-2 pr-2 text-right font-mono text-[11px] font-bold',
                    c.roi > 1 ? 'text-positive' : c.roi <= 0 ? 'text-negative' : 'text-medium',
                  )}
                >
                  {formatDecimal(c.roi, 2)}×
                </td>
                <td
                  className={cn(
                    'py-2 pr-2 text-right font-mono text-[11px]',
                    c.marginImpactPct < 0 ? 'text-negative' : c.marginImpactPct > 0 ? 'text-positive' : 'text-muted',
                  )}
                >
                  {formatDelta(c.marginImpactPct)}
                </td>
                <td className="py-2 pr-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="py-2 text-right">
                  <span
                    className={cn(
                      'inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold capitalize',
                      VERDICT_BADGE[c.verdict],
                    )}
                  >
                    {c.verdict}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
        ROI = incremental revenue ÷ discount cost (API-supplied) · verdicts are the promotions engine&apos;s own
      </p>
    </ChartCard>
  )
}
