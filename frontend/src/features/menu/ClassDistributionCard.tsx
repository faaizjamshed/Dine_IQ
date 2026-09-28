import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme, performanceClassColor } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatPct, humanize } from '@/lib/formatters'
import type { MenuClassSlice } from '@/api/types'

/**
 * ClassDistributionCard — how tracked revenue splits across the API's
 * performance classes (spec §25). Bar length = revenueShare from the API;
 * count badges are display-only repetition of API values.
 *
 * Data: GET /api/intelligence/menu → data.classDistribution.
 */
export function ClassDistributionCard({
  slices,
  loading,
  error,
  onRetry,
  className,
}: {
  slices?: MenuClassSlice[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  if (error) {
    return (
      <ChartCard title="Performance Classes" subtitle="Tracked revenue by class" className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load class distribution." />
      </ChartCard>
    )
  }

  if (loading || !slices) {
    return (
      <ChartCard title="Performance Classes" subtitle="Tracked revenue by class" className={className}>
        <ChartSkeleton height={220} />
      </ChartCard>
    )
  }

  if (slices.length === 0) {
    return (
      <ChartCard title="Performance Classes" subtitle="Tracked revenue by class" className={className}>
        <ChartEmpty message="No class distribution for the selected filters." />
      </ChartCard>
    )
  }

  const max = Math.max(...slices.map((s) => s.revenueShare), 0.0001)

  return (
    <ChartCard
      title="Performance Classes"
      subtitle="Tracked revenue by API-assigned class"
      className={className}
    >
      <ul className="flex flex-col gap-3.5" aria-label="Revenue share by performance class">
        {slices.map((slice) => {
          const color = performanceClassColor(slice.performanceClass, theme)
          return (
            <li key={slice.performanceClass} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {humanize(slice.performanceClass)}
                  <span className="ml-2 font-mono text-[10px] font-normal text-subtle">
                    {slice.count} items
                  </span>
                </span>
                <span className="data-value text-xs font-bold text-foreground">
                  {formatPct(slice.revenueShare * 100)}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-strong"
                role="img"
                aria-label={`${humanize(slice.performanceClass)}: ${formatPct(slice.revenueShare * 100)} of tracked revenue`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max((slice.revenueShare / max) * 100, 2)}%`, backgroundColor: color }}
                />
              </div>
              <p className="font-mono text-[10px] text-subtle">
                {formatPKR(slice.revenue, { compact: true })} tracked revenue
              </p>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
