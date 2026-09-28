import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, FlaskConical, Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DishThumb } from '@/components/ui/dish-thumb'
import { ChartCard } from '@/components/charts'
import { EvidenceList } from '@/components/insights/EvidenceList'
import { InsightStrip } from '@/components/insights/InsightStrip'
import { ModelMetadata } from '@/components/model/ModelMetadata'
import { ErrorState } from '@/components/errors/states'
import { queryKeys, STALE_TIME } from '@/api/queryKeys'
import { fetchMenuItems, runWhatIfSimulation } from '@/api/endpoints'
import { getToken } from '@/api/client'
import { useFilters } from '@/hooks/useFilters'
import { formatPKR, formatInt } from '@/lib/formatters'
import type { WhatIfResult, WhatIfScenarioInput } from '@/api/types'
import { cn } from '@/lib/utils'

/* --------------------------- item combobox -------------------------------- */

function ItemCombobox({
  items,
  value,
  onChange,
}: {
  items: { itemId: string; name: string; category: string; price: number }[]
  value: string | null
  onChange: (itemId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const selected = items.find((i) => i.itemId === value)

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
  }, [items, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Select a menu item to simulate"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-strong px-3 text-left text-xs text-foreground transition-colors hover:border-border-strong"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected ? (
              <>
                <DishThumb itemId={selected.itemId} name={selected.name} size="sm" />
                <span className="truncate">
                  <span className="font-semibold">{selected.name}</span>
                  <span className="ml-2 text-subtle">{selected.category} · {formatPKR(selected.price)}</span>
                </span>
              </>
            ) : (
              <span className="text-subtle">Choose an item…</span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items or categories…"
            aria-label="Search menu items"
            className="h-8 text-xs"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Menu items">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-subtle">No items match.</li>
          )}
          {filtered.map((item) => (
            <li key={item.itemId} role="option" aria-selected={item.itemId === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(item.itemId)
                  setOpen(false)
                  setSearch('')
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-strong',
                  item.itemId === value && 'bg-primary/10',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <DishThumb itemId={item.itemId} name={item.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground">{item.name}</span>
                    <span className="block truncate text-[10px] text-subtle">
                      {item.category} · {formatPKR(item.price)}
                    </span>
                  </span>
                </span>
                {item.itemId === value && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------ slider field ------------------------------- */

function ScenarioSlider({
  label,
  value,
  min,
  max,
  onChange,
  hint,
  disabled = false,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  hint: string
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-muted">{label}</label>
        <span className="data-value text-sm font-bold text-foreground">
          {value > 0 ? `+${value}%` : `${value}%`}
        </span>
      </div>
      <input
        type="range"
        disabled={disabled}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} percent`}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-strong accent-primary"
      />
      <p className="text-[10px] leading-relaxed text-subtle">{hint}</p>
    </div>
  )
}

/* --------------------------- results components ---------------------------- */

/**
 * EstimateBanner — the mandatory "ESTIMATE — NOT ACTUAL RESULTS" label
 * (integrity rule 5). Rendered above every simulation result, always.
 */
function EstimateBanner({
  scopeLabel,
  horizonDays,
  generatedAt,
  modelSlot,
}: {
  scopeLabel: string
  horizonDays: number
  generatedAt?: string
  modelSlot?: React.ReactNode
}) {
  return (
    <div
      role="note"
      aria-label="Estimate disclaimer"
      className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm font-extrabold uppercase tracking-wide text-primary">
          Estimate — not actual results
        </p>
        <span className="ml-auto font-mono text-[10px] text-muted">
          {scopeLabel}
          {generatedAt ? ` · ${new Date(generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}
        </span>
      </div>
      {modelSlot}
    </div>
  )
}

/** Metric rows straight from the API's deltas array — favorability colorized. */
function DeltaTable({ result }: { result: WhatIfResult }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Baseline versus scenario metrics from the simulation</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-3 py-2 text-[10px] uppercase tracking-wider text-subtle">Metric</th>
          <th scope="col" className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-subtle">Baseline</th>
          <th scope="col" className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-subtle">Scenario</th>
          <th scope="col" className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-subtle">Δ</th>
        </tr>
      </thead>
      <tbody>
        {result.deltas.map((d) => {
          const color =
            d.favorability === 'positive'
              ? 'text-positive'
              : d.favorability === 'negative'
                ? 'text-negative'
                : 'text-neutral'
          const isPkr = ['Revenue', 'Contribution profit'].includes(d.metric)
          const fmt = (v: number) =>
            d.metric === 'Contribution margin'
              ? `${v.toFixed(1)}%`
              : d.metric === 'Items sold'
                ? formatInt(v)
                : d.metric === 'Effective price' || isPkr
                  ? formatPKR(v, { compact: isPkr })
                  : String(v)
          return (
            <tr key={d.metric} className="border-b border-border/60">
              <th scope="row" className="px-3 py-2.5 text-xs font-medium text-muted">{d.metric}</th>
              <td className="data-value px-3 py-2.5 text-right text-xs text-muted">{fmt(d.baseline)}</td>
              <td className="data-value px-3 py-2.5 text-right text-xs font-bold text-foreground">{fmt(d.scenario)}</td>
              <td className={cn('data-value px-3 py-2.5 text-right text-xs font-bold', color)}>
                {d.deltaPct > 0 ? '+' : ''}
                {d.deltaPct}%
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* --------------------------------- page ----------------------------------- */

/**
 * What-If Simulator page (spec §27).
 *
 * The backend owns the model. This page composes a scenario (item, price
 * change, discount, preparation change, horizon), POSTs it to
 * /api/what-if and renders the response — baseline vs scenario,
 * deltas, assumptions and notes — under a PERSISTENT
 * "ESTIMATE — NOT ACTUAL RESULTS" banner (integrity rule 5).
 *
 * No result is shown before the user runs a simulation; scope filters are
 * carried in the POST query string and echoed back via `scopeLabel`.
 * Route access is guarded by the whatif.run permission (see routes).
 */
export function WhatIfPage() {
  const { filters } = useFilters()
  const auth = React.useMemo(() => {
    const token = getToken()
    return { Authorization: token ? `Bearer ${token}` : '' }
  }, [])

  // Reference list for the item picker (reacts to the global category filter).
  const itemsQuery = useQuery({
    queryKey: queryKeys.menuItems(filters),
    queryFn: () => fetchMenuItems(filters, auth),
    staleTime: STALE_TIME.kpis,
  })
  const items = itemsQuery.data?.data.items ?? []

  const [itemId, setItemId] = React.useState<string | null>(null)
  const [priceChangePct, setPriceChangePct] = React.useState(0)
  const [discountPct, setDiscountPct] = React.useState(0)
  const [prepChangePct, setPrepChangePct] = React.useState(0)
  const [elasticity, setElasticity] = React.useState(0)
  const [horizonDays, setHorizonDays] = React.useState<7 | 14 | 30>(7)
  const [lastRun, setLastRun] = React.useState<WhatIfScenarioInput | null>(null)

  const simulate = useMutation({
    mutationFn: (input: WhatIfScenarioInput) => runWhatIfSimulation(input, filters, auth),
    onSuccess: (_data, input) => setLastRun(input),
  })

  const result: WhatIfResult | undefined = simulate.data?.data
  const meta = simulate.data?.meta
  const model =
    meta?.modelName && meta?.modelVersion && meta?.generatedAt && meta?.pipeline
      ? {
          name: meta.modelName,
          version: meta.modelVersion,
          generatedAt: meta.generatedAt,
          pipeline: meta.pipeline,
        }
      : undefined

  const run = () => {
    if (!itemId) return
    simulate.mutate({ itemId, priceChangePct, discountPct, prepChangePct, horizonDays, elasticity })
  }

  const scopeChanged =
    lastRun != null &&
    (lastRun.itemId !== itemId ||
      lastRun.priceChangePct !== priceChangePct ||
      lastRun.discountPct !== discountPct ||
      lastRun.prepChangePct !== prepChangePct ||
      lastRun.elasticity !== elasticity ||
      lastRun.horizonDays !== horizonDays)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 xl:grid-cols-3">
        {/* Scenario form */}
        <ChartCard
          title="Scenario"
          subtitle="Price arithmetic using historical units and your elasticity assumption"
          className="xl:sticky xl:top-0"
          contentClassName="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Menu item</span>
            <ItemCombobox items={items} value={itemId} onChange={setItemId} />
            {itemsQuery.isLoading && (
              <p className="inline-flex items-center gap-1.5 text-[10px] text-subtle">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading menu…
              </p>
            )}
          </div>

          <ScenarioSlider
            label="Price change"
            value={priceChangePct}
            min={-20}
            max={20}
            onChange={setPriceChangePct}
            hint="Applied to the catalog price. Demand response uses the elasticity you supply below."
          />
          <ScenarioSlider
            label="Discount"
            value={discountPct}
            min={0}
            max={30}
            onChange={setDiscountPct}
            hint="Reduces the adjusted price. No promotion lift or fatigue is inferred."
          />
          <ScenarioSlider
            label="Preparation / stock change"
            disabled
            value={prepChangePct}
            min={-30}
            max={10}
            onChange={setPrepChangePct}
            hint="Unavailable for this combined price scenario. The backend requires separate preparation inputs."
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted" htmlFor="elasticity">Elasticity assumption (−10 to 0)</label>
            <Input id="elasticity" type="number" min="-10" max="0" step="0.1" value={elasticity} onChange={e => setElasticity(Number(e.target.value))} />
            <p className="text-[10px] text-subtle">0 means unchanged demand. This is your assumption, not a fitted causal estimate.</p>
            <span className="text-xs font-semibold text-muted">Horizon unavailable · full historical units</span>
            <div className="flex gap-1.5" role="group" aria-label="Simulation horizon in days">
              {([7, 14, 30] as const).map((d) => (
                <button
                  key={d}
                  disabled
                  type="button"
                  onClick={() => setHorizonDays(d)}
                  aria-pressed={horizonDays === d}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors',
                    horizonDays === d
                      ? 'border-primary/40 bg-primary/12 text-foreground'
                      : 'border-border text-muted hover:bg-surface-strong hover:text-foreground',
                  )}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>

          <Button onClick={run} disabled={!itemId || simulate.isPending || !Number.isFinite(elasticity) || elasticity < -10 || elasticity > 0} className="w-full gap-2">
            {simulate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Simulating…
              </>
            ) : (
              <>
                <FlaskConical className="h-4 w-4" aria-hidden /> Run simulation
              </>
            )}
          </Button>

          <p className="font-mono text-[10px] leading-relaxed text-subtle">
            Uses full historical units and catalog unit price/cost from the selected item. Date, outlet and channel scopes are unavailable.
          </p>
        </ChartCard>

        {/* Results column */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          {simulate.error ? (
            <ErrorState
              title="Simulation unavailable"
              description={
                simulate.error instanceof Error
                  ? simulate.error.message
                  : 'The scenario engine could not process this input. Adjust the levers and retry.'
              }
              retry={() => simulate.reset()}
            />
          ) : !result ? (
            <div className="glass-card flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-strong">
                <FlaskConical className="h-6 w-6 text-primary" aria-hidden />
              </span>
              <p className="text-sm font-bold text-foreground">No simulation yet</p>
              <p className="max-w-md text-xs leading-relaxed text-muted">
                Choose a menu item, set price, discount and your elasticity assumption, then run the
                simulation. No estimates are shown until the scenario engine returns output —
                this panel never invents numbers.
              </p>
            </div>
          ) : (
            <>
              {/* MANDATORY estimate labeling (integrity rule 5) */}
              <EstimateBanner
                scopeLabel={result.scopeLabel}
                horizonDays={result.horizonDays}
                generatedAt={meta?.generatedAt}
                modelSlot={<ModelMetadata model={model} dense className="pl-6" />}
              />

              {scopeChanged && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-strong px-3 py-2 text-xs text-muted"
                >
                  <Info className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                  Scenario inputs changed since this result — re-run to refresh the estimate.
                </div>
              )}

              <InsightStrip
                insight={simulate.data?.insight}
                source="POST /api/what-if"
                generatedAt={meta?.generatedAt}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                  title="Baseline vs Scenario"
                  subtitle={`${result.itemName} · ${result.category}`}
                >
                  <DeltaTable result={result} />
                  <p className="mt-3 font-mono text-[10px] leading-relaxed text-subtle">
                    Δ colors follow the API's favorability, not raw direction.
                  </p>
                </ChartCard>

                <ChartCard
                  title="Assumptions & Notes"
                  subtitle="Supplied verbatim by the scenario engine"
                  contentClassName="flex flex-col gap-4"
                >
                  <div>
                    <p className="overline-label mb-2 text-subtle">Assumptions</p>
                    <EvidenceList evidence={result.assumptions} />
                  </div>
                  <div>
                    <p className="overline-label mb-2 text-subtle">Notes</p>
                    <ul className="flex flex-col gap-1.5">
                      {result.notes.map((note, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                          <Info className="mt-0.5 h-3 w-3 shrink-0 text-subtle" aria-hidden />
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                </ChartCard>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => simulate.mutate(lastRun ?? { itemId: result.itemId, priceChangePct, discountPct, prepChangePct, horizonDays })}
                  disabled={simulate.isPending}
                  className="gap-1.5"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', simulate.isPending && 'animate-spin')} aria-hidden />
                  Re-run last scenario
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
