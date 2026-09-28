import { formatDecimal } from '@/lib/formatters'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { formatPKR, formatInt, formatPct } from '@/lib/formatters'
import type { ChannelComparison } from '@/api/types'

/** "13" → "13:00" — hour-of-day rendering for API peakHours entries. */
function formatHour(h: number): string {
  return `${h}:00`
}

/**
 * ChannelCard — one card per channel row (GET /api/channels →
 * data.channels). Each field is rendered verbatim: revenue, share, orders,
 * basket size, AOV, discount %, platform fee %, contribution margin % and
 * peak hours.
 *
 * Integrity notes:
 *  - Platform fee "0%" is meaningful, not missing: fee = 0 marks a
 *    first-party channel (no aggregator cut), so it renders as a real "0%"
 *    with a first-party hint instead of an em dash.
 *  - The API supplies NO favorability thresholds for contribution margin, so
 *    per integrity rule 1 the frontend invents none — every number stays
 *    mono/neutral. The only color is the accent bar under the channel name,
 *    whose width encodes the API revenueShare (share of national revenue).
 */
function ChannelCard({ channel }: { channel: ChannelComparison }) {
  const fee = channel.platformFeePct
  const rows: { label: string; value: string; hint?: string }[] = [
    { label: 'Revenue share', value: formatPct(channel.revenueShare * 100) },
    { label: 'Orders', value: formatInt(channel.orders) },
    { label: 'Basket size', value: `${formatDecimal(channel.basketSize, 1)} items/order` },
    { label: 'AOV', value: formatPKR(channel.aov) },
    { label: 'Discount', value: formatPct(channel.discountPct) },
    { label: 'Platform fee', value: fee === 0 ? formatPct(0, 0) : formatPct(fee), hint: fee === 0 ? 'first-party' : undefined },
    { label: 'Contribution margin', value: formatPct(channel.contributionMarginPct) },
  ]

  return (
    <article className="glass-card flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="truncate text-sm font-bold tracking-tight text-foreground">{channel.label}</h3>
        {/* Accent bar — width = API revenueShare, the only color on the card */}
        <span className="h-1 w-full overflow-hidden rounded-full bg-surface-strong" aria-hidden>
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.max(2, channel.revenueShare * 100)}%` }}
          />
        </span>
      </div>

      <span className="data-value text-xl font-bold leading-none text-foreground">
        {formatPKR(channel.revenue, { compact: true })}
      </span>

      <dl className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-[10px] uppercase tracking-wide text-subtle">{r.label}</dt>
            <dd className="font-mono text-[11px] text-foreground">
              {r.value}
              {r.hint && <span className="ml-1 text-[9px] normal-case text-subtle">({r.hint})</span>}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-auto border-t border-border pt-2 font-mono text-[10px] leading-relaxed text-subtle">
        Peak {channel.peakHours.map(formatHour).join(' · ')}
      </p>
    </article>
  )
}

/**
 * ChannelCards — the channel economics grid (md: 2 columns, xl: 4). One card
 * per API row, in the order the backend ships them.
 */
export function ChannelCards({
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
  const title = 'Channel Economics'
  const subtitle = 'Dine-in, delivery, takeaway and app side by side — one card per channel'

  if (error) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load channel economics." />
      </ChartCard>
    )
  }
  if (loading || !channels) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={260} />
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
      contentClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
    >
      {channels.map((c) => (
        <ChannelCard key={c.channel} channel={c} />
      ))}
    </ChartCard>
  )
}
