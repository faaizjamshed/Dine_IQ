import { formatDecimal } from '@/lib/formatters'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import type { ChannelComparison } from '@/api/types'
import { cn } from '@/lib/utils'

/** "13" → "13:00" — hour-of-day rendering for API peakHours entries. */
function formatHour(h: number): string {
  return `${h}:00`
}

/**
 * ChannelEconomicsTable — the full channel comparison rows
 * (GET /api/channels → data.channels).
 *
 * Columns: Channel · Revenue · Orders · AOV · Basket Size · Discount % ·
 * Platform Fee % · Contribution Margin % · Peak Hours. Values verbatim; a
 * 0% platform fee is rendered as a real "0%" because it means the channel is
 * first-party (no aggregator cut) — never as missing data. The API supplies
 * no favorability thresholds, so no business coloring is invented here.
 * Sticky head + max-h-96 scroll keeps long channel lists inside the card.
 */
export function ChannelEconomicsTable({
  channels,
  loading,
  error,
  onRetry,
  className,
}: {
  channels?: ChannelComparison[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const title = 'Channel Comparison'
  const subtitle = 'Full economics rows per channel, as shipped by the backend'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load channel comparison." />
      </ChartCard>
    )
  }
  if (loading || channels === undefined) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={220} />
      </ChartCard>
    )
  }
  if (channels.length === 0) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartEmpty message="No channel data for the selected filters." />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="flex flex-col"
    >
      <div className="-mx-1 max-h-96 overflow-auto rounded-xl border border-border dineiq-scrollbar">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">
            Channels with revenue, orders, average order value, basket size, discount, platform fee, contribution margin and peak hours
          </caption>
          <thead className="sticky top-0 z-10 bg-background-subtle/95 backdrop-blur-sm">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-subtle">Channel</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">Revenue</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">Orders</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">AOV</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle sm:table-cell">Basket</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle md:table-cell">Discount</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle md:table-cell">Fee</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle">Margin</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-subtle lg:table-cell">Peak hours</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c, index) => (
              <tr
                key={c.channel}
                className={cn(
                  'border-b border-border/60 transition-colors hover:bg-surface-strong/70',
                  index % 2 === 1 && 'bg-surface/40',
                )}
              >
                <td className="px-3 py-2 text-xs font-semibold text-foreground">{c.label}</td>
                <td className="data-value px-3 py-2 text-right text-xs font-semibold text-foreground">
                  {formatPKR(c.revenue, { compact: true })}
                </td>
                <td className="data-value px-3 py-2 text-right text-xs text-muted">{formatInt(c.orders)}</td>
                <td className="data-value px-3 py-2 text-right text-xs text-muted">{formatPKR(c.aov)}</td>
                <td className="data-value hidden px-3 py-2 text-right text-xs text-muted sm:table-cell">
                  {formatDecimal(c.basketSize, 1)}
                </td>
                <td className="data-value hidden px-3 py-2 text-right text-xs text-muted md:table-cell">
                  {formatPct(c.discountPct)}
                </td>
                <td className="data-value hidden px-3 py-2 text-right text-xs text-muted md:table-cell">
                  {c.platformFeePct === 0 ? formatPct(0, 0) : formatPct(c.platformFeePct)}
                </td>
                <td className="data-value px-3 py-2 text-right text-xs text-foreground">
                  {formatPct(c.contributionMarginPct)}
                </td>
                <td className="hidden px-3 py-2 text-right font-mono text-[10px] text-subtle lg:table-cell">
                  {c.peakHours.map(formatHour).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
        Fee 0% = first-party channel (no aggregator cut) · values verbatim from GET /api/channels
      </p>
    </ChartCard>
  )
}
