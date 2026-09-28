import { formatDecimal } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPKR, formatInt, formatPct, formatDelta } from '@/lib/formatters'
import type { ForecastKpis, ResponseMeta } from '@/api/types'

/** Small stat card shared by the forecast KPI strip — values verbatim from the API. */
function ForecastStatCard({
  label,
  value,
  context,
  accent,
}: {
  label: string
  value: string
  context?: string
  accent?: string
}) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3.5">
      <span className="truncate text-[11px] font-semibold text-muted">{label}</span>
      <span
        className={`data-value text-xl font-bold leading-none ${accent ?? 'text-foreground'}`}
      >
        {value}
      </span>
      {context && <span className="truncate text-[10px] text-subtle">{context}</span>}
    </div>
  )
}

export function ForecastKpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * Renders the six demand-forecast KPIs the API supplies
 * (GET /api/ml/demand-comparison → kpis) — no client-side aggregation.
 *
 * DATA-INTEGRITY: every value on these cards is a MODEL ESTIMATE produced by
 * the DemandForecaster pipeline, not an observed actual. The model context on
 * the first card (name + version from the response meta) and the estimate
 * notes keep that distinction visible to reviewers.
 */
export function ForecastKpiRow({ kpis, meta }: { kpis: ForecastKpis; meta?: ResponseMeta }) {
  const modelContext = meta?.modelName
    ? `${meta.modelName}${meta?.modelVersion ? ` v${meta.modelVersion}` : ''}`
    : 'Data unavailable'

  return (
    <section aria-label="Forecast KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <ForecastStatCard
        label="Multi-day forecast orders"
        value={formatInt(kpis.forecastOrders)}
        context={modelContext}
      />
      <ForecastStatCard
        label="Forecast revenue"
        value={formatPKR(kpis.forecastRevenue, { compact: true })}
        context="Model estimate — not actuals"
      />
      <ForecastStatCard
        label="Backtest MAPE"
        value={formatPct(kpis.mapePct)}
        context="Not supplied by the backend"
      />
      <ForecastStatCard
        label="Bias"
        value={formatDelta(kpis.biasPct)}
        context="positive = over-forecast"
        accent={kpis.biasPct > 0 ? 'text-negative' : kpis.biasPct < 0 ? 'text-positive' : 'text-foreground'}
      />
      <ForecastStatCard
        label="Confidence"
        value={formatDecimal(kpis.confidence, 3)}
        context="Model-reported"
      />
      <ForecastStatCard
        label="Horizon"
        value={formatDecimal(kpis.horizonDays, 0)}
        context="Forecast window"
      />
    </section>
  )
}
