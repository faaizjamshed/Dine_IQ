import { formatDecimal } from '@/lib/formatters'
import { ChartCard, ChartSkeleton } from '@/components/charts'
import { getChartTheme } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatInt, formatPct } from '@/lib/formatters'
import type { ForecastAccuracyRow, Pipeline } from '@/api/types'

/**
 * Pipeline badge — violet tint for the Spark pipeline, sky tint for Python.
 * Colors come from the shared chart theme so the badges follow the active
 * light/dark theme exactly like every other chart element.
 */
function PipelineBadge({ pipeline }: { pipeline: Pipeline }) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)
  const color = pipeline === 'spark' ? theme.series.violet : theme.series.sky
  return (
    <span
      className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {pipeline === 'spark' ? 'Spark' : 'Python'}
    </span>
  )
}

/**
 * AccuracyTable — backtest comparison of the forecasting models the API
 * evaluated (GET /api/ml/demand-comparison → accuracy). Ordering is preserved
 * exactly as the backend ships it; the row with the LOWEST MAPE is
 * highlighted because lower error is better (a presentation-only emphasis,
 * not a re-ranking).
 */
export function AccuracyTable({
  rows,
  loading,
  className,
}: {
  rows?: ForecastAccuracyRow[]
  loading?: boolean
  className?: string
}) {
  const title = 'Model Accuracy (Backtest)'
  const subtitle = 'Held-out hourly order predictions; model weekday semantics differ'

  if (loading || !rows) {
    return (
      <ChartCard title={title} subtitle={subtitle} className={className}>
        <ChartSkeleton height={240} />
      </ChartCard>
    )
  }

  const bestMape = rows.length > 0 ? Math.min(...rows.map((r) => r.mapePct)) : NaN

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName="max-h-96 overflow-auto dineiq-scrollbar"
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-subtle">No backtest rows in the API response.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wide text-subtle">
              <th scope="col" className="border-l-2 border-l-transparent py-2 pr-2 font-semibold">Model</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Pipeline</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">MAE</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">RMSE</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">R²</th>
              <th scope="col" className="py-2 text-right font-semibold">Horizon</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isBest = r.mapePct === bestMape
              return (
                <tr
                  key={`${r.modelName}-${r.pipeline}`}
                  className={`border-t border-border/60 text-xs ${isBest ? 'bg-positive/5' : ''}`}
                >
                  <td
                    className={`py-2 pr-2 font-medium text-foreground ${isBest ? 'border-l-2 border-l-positive' : ''}`}
                  >
                    {r.modelName}
                  </td>
                  <td className="py-2 pr-2">
                    <PipelineBadge pipeline={r.pipeline} />
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] font-bold text-foreground">
                    {formatDecimal(r.mae ?? NaN, 3)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                    {formatDecimal(r.rmse, 3)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[11px] text-muted">
                    {formatDecimal(r.r2 ?? NaN, 3)}
                  </td>
                  <td className="py-2 text-right font-mono text-[11px] text-muted">
                    1 hour
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
        Historical evaluation only. Lower MAE/RMSE is better; compare the documented feature semantics before interpreting model differences.
      </p>
    </ChartCard>
  )
}
