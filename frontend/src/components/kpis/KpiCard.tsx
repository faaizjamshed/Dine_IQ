import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sparkline } from '@/components/charts'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { useCountUp } from '@/hooks/useCountUp'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import {
  formatPKR,
  formatNumberCompact,
  formatRating,
  formatDelta,
  formatInt,
} from '@/lib/formatters'
import type { Kpi } from '@/api/types'
import { cn } from '@/lib/utils'

/**
 * KpiCard — one executive KPI (spec §24).
 *
 * Displays: label · dominant mono value (count-up) · period delta ·
 * comparison label · sparkline · API source tooltip.
 *
 * Integrity notes:
 *  - Value/series come verbatim from GET /api/overview; nothing is computed here.
 *  - Delta color follows the API's deltaFavorability (e.g. rising wastage
 *    renders negative even though the number went up) — the frontend never
 *    applies its own business semantics.
 */
export const KpiCard = React.memo(function KpiCard({
  kpi,
  className,
}: {
  kpi: Kpi
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const animated = useCountUp(Number.isFinite(kpi.value) ? kpi.value : 0)

  const favorability = kpi.deltaFavorability ?? 'neutral'
  const deltaColor =
    favorability === 'positive'
      ? 'text-positive'
      : favorability === 'negative'
        ? 'text-negative'
        : 'text-neutral'
  const sparkColor =
    favorability === 'positive'
      ? theme.series.emerald
      : favorability === 'negative'
        ? theme.series.rose
        : theme.series.primary

  const formatted = (() => {
    if (!Number.isFinite(kpi.value)) return '—'
    switch (kpi.unit) {
      case 'pkr':
        return formatPKR(animated, { compact: Math.abs(kpi.value) >= 100000 })
      case 'percent':
        return `${animated.toFixed(1)}%`
      case 'rating':
        return formatRating(animated)
      default:
        return Math.abs(kpi.value) >= 100000 ? formatNumberCompact(animated) : formatInt(animated)
    }
  })()

  return (
    <div
      className={cn(
        'glass-card group flex flex-col gap-2 p-4 transition-colors hover:border-border-strong',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-muted">{kpi.label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`About ${kpi.label}`}
              className="rounded p-0.5 text-subtle opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-56">
            <span className="font-mono text-[10px] leading-relaxed">
              Source: {kpi.source}
              {kpi.comparisonLabel ? ` · ${kpi.comparisonLabel}` : ''}
            </span>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="data-value text-2xl font-bold leading-none text-foreground">
          {formatted}
        </span>
        {typeof kpi.deltaPct === 'number' && (
          <span
            className={cn('inline-flex items-center gap-0.5 text-xs font-bold', deltaColor)}
            aria-label={`${formatDelta(kpi.deltaPct)} versus ${kpi.comparisonLabel ?? 'previous period'}`}
          >
            {kpi.deltaDirection === 'up' ? (
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            ) : kpi.deltaDirection === 'down' ? (
              <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            )}
            {formatDelta(kpi.deltaPct)}
          </span>
        )}
      </div>

      {kpi.sparkline && kpi.sparkline.length > 0 && (
        <Sparkline points={kpi.sparkline} color={sparkColor} height={34} />
      )}

      {kpi.comparisonLabel && (
        <span className="text-[10px] text-subtle">{kpi.comparisonLabel}</span>
      )}

      {kpi.model && <ModelMetadata model={kpi.model} dense className="mt-auto pt-1" />}
    </div>
  )
})

/** Layout-matching skeleton for the KPI grid loading state. */
export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card flex flex-col gap-2 p-4', className)} aria-busy="true">
      <div className="h-3 w-24 animate-pulse rounded bg-surface-strong" />
      <div className="h-8 w-32 animate-pulse rounded bg-surface-strong" />
      <div className="h-9 w-full animate-pulse rounded bg-surface-strong" />
      <div className="h-2.5 w-28 animate-pulse rounded bg-surface-strong" />
    </div>
  )
}
