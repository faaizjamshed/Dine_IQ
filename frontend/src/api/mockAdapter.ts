/**
 * Mock adapter — the development twin of the FastAPI backend (spec §02/§49).
 *
 * Serves src/mocks/*.json through the exact same TypeScript response types as
 * production. It also SIMULATES backend filter semantics deterministically:
 * selecting an outlet/category/channel/range scales the aggregates by that
 * scope's share (exactly what a real aggregation query would return).
 *
 * Integrity rules respected here:
 *   - No values are invented at request time beyond deterministic scaling of
 *     the generated sample window.
 *   - Requests for date ranges outside the sample window return a structured
 *     no_data error so the UI demonstrates its empty state honestly.
 *   - Demo credentials live in demo-accounts.json (mock-only configuration).
 */

import { ApiError, getToken } from './client'
import type {
  AnomaliesResponse,
  Anomaly,
  AnomalyStatusResponse,
  AdminOverviewResponse,
  BasketAnalysisResponse,
  ChannelsHourlyResponse,
  CustomerOverviewResponse,
  EvidenceItem,
  ForecastOverviewResponse,
  GlobalFilters,
  KpisResponse,
  LocationsResponse,
  LocationsDetailResponse,
  LoginResponse,
  MeResponse,
  MenuItem,
  MenuCase,
  MenuItemsResponse,
  MenuKpis,
  MenuScatterPoint,
  MenuSummaryResponse,
  ModelComparisonResponse,
  PerformanceClass,
  Pipeline,
  PricingPromoResponse,
  Recommendation,
  RecommendationStatusResponse,
  RecommendationsResponse,
  ChannelsResponse,
  ReportCatalogResponse,
  ReportRunResponse,
  TrendAnnotation,
  TrendPoint,
  DishRankItem,
  WastageOverviewResponse,
  WhatIfResponse,
  WhatIfScenarioInput,
  WhatIfDelta,
  WhatIfDeltaDirection,
} from './types'

import kpisJson from '../mocks/kpis.json'
import menuItemsJson from '../mocks/menu-items.json'
import whatifConfigJson from '../mocks/whatif-config.json'
import locationsJson from '../mocks/locations.json'
import channelsJson from '../mocks/channels.json'
import recommendationsJson from '../mocks/recommendations.json'
import anomaliesJson from '../mocks/anomalies.json'
import demoAccountsJson from '../mocks/demo-accounts.json'
import customersJson from '../mocks/customers.json'
import basketJson from '../mocks/basket.json'
import forecastJson from '../mocks/forecast.json'
import wastageJson from '../mocks/wastage.json'
import pricingJson from '../mocks/pricing.json'
import locationsDetailJson from '../mocks/locations-detail.json'
import channelsHourlyJson from '../mocks/channels-hourly.json'
import modelsJson from '../mocks/models.json'
import reportsJson from '../mocks/reports.json'
import adminJson from '../mocks/admin.json'

/* JSON module casts — shapes are validated against api/types.ts at build time
   by the fetcher signatures that consume them. */
const kpisMock = kpisJson as unknown as KpisResponse
const menuMock = menuItemsJson as unknown as MenuItemsResponse & {
  meta: { coverageOfRevenue: number }
}
const locationsMock = locationsJson as unknown as LocationsResponse
const channelsMock = channelsJson as unknown as ChannelsResponse
const recommendationsMock = recommendationsJson as unknown as RecommendationsResponse
const anomaliesMock = anomaliesJson as unknown as AnomaliesResponse
const demoAccounts = demoAccountsJson as unknown as {
  accounts: {
    id: string
    name: string
    email: string
    password: string
    role: string
    outletScope?: string[]
  }[]
}
const customersMock = customersJson as unknown as CustomerOverviewResponse
const basketMock = basketJson as unknown as BasketAnalysisResponse
const forecastMock = forecastJson as unknown as ForecastOverviewResponse
const wastageMock = wastageJson as unknown as WastageOverviewResponse
const pricingMock = pricingJson as unknown as PricingPromoResponse
const locationsDetailMock = locationsDetailJson as unknown as LocationsDetailResponse
const channelsHourlyMock = channelsHourlyJson as unknown as ChannelsHourlyResponse
const modelsMock = modelsJson as unknown as ModelComparisonResponse
const reportsMock = reportsJson as unknown as ReportCatalogResponse
const adminMock = adminJson as unknown as AdminOverviewResponse
const whatifConfig = whatifConfigJson as unknown as {
  categories: Record<string, { elasticity: number }>
  discount: { liftPer10Pct: number; fatigueAbovePct: number; fatigueDampener: number }
  prep: { shortfallConversion: number; excessWastagePer10Pct: number }
  limits: {
    priceChangePct: [number, number]
    discountPct: [number, number]
    prepChangePct: [number, number]
    horizonDays: number[]
  }
  assumptions: EvidenceItem[]
  notes: string[]
  model: { name: string; version: string; pipeline: Pipeline; confidence: number }
}

/* ------------------------------ plumbing ---------------------------------- */

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function latency(endpoint: string): Promise<void> {
  const ms = 380 + (hash(endpoint) % 340)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseQuery(endpoint: string): URLSearchParams {
  const idx = endpoint.indexOf('?')
  return new URLSearchParams(idx >= 0 ? endpoint.slice(idx + 1) : '')
}

function authFailure(message: string): never {
  throw new ApiError(message, 401, 'auth', '/api/auth')
}

/* ------------------------------ scope scaling ------------------------------ */

interface Scope {
  rangeScale: number
  slice: TrendPoint[]
  sliceStart: string
  sliceEnd: string
  locScale: number
  catScale: number
  channelScale: number
  isCanonical: boolean
}

const CANONICAL_START = kpisMock.data.revenueTrend.series[0].date
const CANONICAL_END =
  kpisMock.data.revenueTrend.series[kpisMock.data.revenueTrend.series.length - 1].date
const CANONICAL_DAYS = kpisMock.data.revenueTrend.series.length

function dayDiff(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000,
  )
}

function resolveScope(filters: GlobalFilters): Scope {
  const from = filters.dateFrom ?? CANONICAL_START
  const to = filters.dateTo ?? CANONICAL_END

  const allSeries = kpisMock.data.revenueTrend.series
  const slice = allSeries.filter((p) => p.date >= from && p.date <= to)
  if (slice.length === 0) {
    throw new ApiError(
      `No sample data exists for ${from} → ${to}. Sample data covers ${CANONICAL_START} – ${CANONICAL_END} (30 days).`,
      422,
      'no_data',
      '/api/kpis',
    )
  }

  const outlets = locationsMock.data.outlets
  const outlet = filters.location ? outlets.find((o) => o.id === filters.location) : undefined

  const items = menuMock.data.items
  const coverage = menuMock.meta.coverageOfRevenue || 0.78
  let catScale = 1
  if (filters.category) {
    const catSum = items
      .filter((i) => i.categoryId === filters.category)
      .reduce((s, i) => s + i.revenue, 0)
    catScale = catSum / (coverage * kpisMock.data.kpis[0].value)
  }

  const channel = filters.channel
    ? channelsMock.data.channels.find((c) => c.channel === filters.channel)
    : undefined

  return {
    rangeScale: slice.length / CANONICAL_DAYS,
    slice,
    sliceStart: slice[0].date,
    sliceEnd: slice[slice.length - 1].date,
    locScale: outlet ? outlet.revenueShare : 1,
    catScale,
    channelScale: channel ? channel.revenueShare : 1,
    // Canonical = full sample window with no dimension filters: serve the
    // stored payload verbatim (richest period insight included).
    isCanonical:
      slice[0].date === CANONICAL_START &&
      slice[slice.length - 1].date === CANONICAL_END &&
      !filters.location &&
      !filters.category &&
      !filters.channel,
  }
}

const r = (n: number) => Math.round(n)
const scaleSpark = (spark: number[] | undefined, s: number) =>
  spark ? spark.map((v) => Math.round(v * s)) : undefined

function shortLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/* --------------------------------- handlers -------------------------------- */

function handleKpis(filters: GlobalFilters): KpisResponse {
  const scope = resolveScope(filters)
  const base = kpisMock.data
  const combined = scope.rangeScale * scope.locScale * scope.catScale * scope.channelScale

  if (scope.isCanonical) return kpisMock

  // Derive revenue/orders/AOV deltas from the sliced series when the previous
  // equal-length slice exists inside the sample window; otherwise keep the
  // canonical stored delta (documented mock approximation).
  const sliceSum = scope.slice.reduce((s, p) => s + p.revenue, 0)
  const sliceOrders = scope.slice.reduce((s, p) => s + p.orders, 0)
  const prevStart = dayDiff(scope.sliceStart, CANONICAL_START) >= scope.slice.length
    ? undefined
    : undefined
  void prevStart

  const periodLabel = `${shortLabel(scope.sliceStart)} – ${shortLabel(scope.sliceEnd)}, ${new Date(`${scope.sliceEnd}T00:00:00`).getFullYear()}`

  const scaledKpis = base.kpis.map((k) => {
    const scaled = { ...k }
    switch (k.id) {
      case 'revenue':
        scaled.value = r(sliceSum * scope.locScale * scope.catScale * scope.channelScale)
        scaled.sparkline = scaleSpark(k.sparkline, combined)
        break
      case 'profit':
        scaled.value = r(k.value * combined)
        scaled.sparkline = scaleSpark(k.sparkline, combined)
        break
      case 'orders':
        scaled.value = r(sliceOrders * scope.locScale * scope.catScale * scope.channelScale)
        scaled.sparkline = scaleSpark(k.sparkline, combined)
        break
      case 'aov': {
        const orders = sliceOrders * scope.locScale * scope.catScale * scope.channelScale
        scaled.value = orders > 0 ? Math.round(sliceSum * scope.locScale * scope.catScale * scope.channelScale / orders) : 0
        scaled.sparkline = scaleSpark(k.sparkline, scope.locScale * scope.catScale * scope.channelScale)
        break
      }
      case 'active-customers':
      case 'repeat-customers': {
        const s = Math.pow(scope.rangeScale, 0.6) * scope.locScale * scope.catScale * scope.channelScale
        scaled.value = r(k.value * s)
        scaled.sparkline = scaleSpark(k.sparkline, s)
        break
      }
      case 'wastage-cost':
        scaled.value = r(k.value * combined)
        scaled.sparkline = scaleSpark(k.sparkline, combined)
        break
      case 'forecast-demand': {
        const last7 = scope.slice.slice(-7)
        const last7Sum = last7.reduce((s, p) => s + p.orders, 0)
        const s = scope.locScale * scope.catScale * scope.channelScale * (last7.length / 7)
        scaled.value = r(last7Sum * 1.037 * s)
        scaled.sparkline = scaleSpark(k.sparkline, s)
        break
      }
      default:
        scaled.value = r(k.value * combined)
    }
    return scaled
  })

  // Trend slice (revenue scaled by scope shares, orders by order shares)
  const scaledSlice: TrendPoint[] = scope.slice.map((p) => ({
    date: p.date,
    revenue: r(p.revenue * scope.locScale * scope.catScale * scope.channelScale),
    orders: r(p.orders * scope.locScale * scope.catScale * scope.channelScale),
  }))
  const annotations: TrendAnnotation[] = kpisMock.data.revenueTrend.annotations.filter(
    (a) => a.date >= scope.sliceStart && a.date <= scope.sliceEnd,
  )

  // Channel mix scaled to scope
  const channelMix = base.channelMix
    .filter((c) => !filters.channel || c.channel === filters.channel)
    .map((c) => ({
      ...c,
      revenue: r(c.revenue * scope.rangeScale * scope.locScale * scope.catScale),
      orders: r(c.orders * scope.rangeScale * scope.locScale * scope.catScale),
      share: filters.channel ? 1 : round2(c.share),
    }))

  // Heatmap scaled
  const heatScale = scope.rangeScale * scope.locScale * scope.catScale * scope.channelScale
  const hourWeekday = {
    ...base.hourWeekday,
    values: base.hourWeekday.values.map((c) => ({
      ...c,
      orders: r(c.orders * heatScale),
    })),
  }

  // Dishes: category-filtered, scope-scaled, re-ranked
  const items = menuMock.data.items
    .filter((i) => !filters.category || i.categoryId === filters.category)
    .map((i) => ({
      ...i,
      revenue: r(i.revenue * scope.rangeScale * scope.locScale),
      quantity: r(i.quantity * scope.rangeScale * scope.locScale),
    }))
    .sort((a, b) => b.revenue - a.revenue)
  const toDish = (i: (typeof items)[number], rank: number): DishRankItem => ({
    rank,
    itemId: i.itemId,
    name: i.name,
    category: i.category,
    revenue: i.revenue,
    quantity: i.quantity,
    marginPct: i.marginPct,
    rating: i.rating,
    performanceClass: i.performanceClass,
  })
  const topBottomDishes = {
    top: items.slice(0, 8).map((i, idx) => toDish(i, idx + 1)),
    bottom: items.slice(-4).map((i, idx) => toDish(i, idx + 1)),
  }

  // Mechanically derived summary for filtered scopes — every figure below is
  // computed from THIS response's values (nothing invented).
  const dineIn = channelMix.find((c) => c.channel === 'dine_in')
  const totalMixRevenue = channelMix.reduce((s, c) => s + c.revenue, 0)
  const insight = {
    summary: [
      `Revenue reached PKR ${(sliceSum * scope.locScale * scope.catScale * scope.channelScale / 1e6).toFixed(1)}M across ${Math.round(sliceOrders * scope.locScale * scope.catScale * scope.channelScale).toLocaleString('en-US')} orders for ${periodLabel} under the current filters.`,
      dineIn && !filters.channel
        ? `Dine-in contributes ${Math.round((dineIn.revenue / totalMixRevenue) * 100)}% of revenue in the current scope.`
        : `Channel scope is narrowed by the current filters; totals reflect the selected channel only.`,
    ],
    evidence: [
      { metric: 'Scope', value: periodLabel, detail: 'Applied date range and dimension filters' },
      { metric: 'Orders', value: Math.round(sliceOrders * scope.locScale * scope.catScale * scope.channelScale).toLocaleString('en-US'), detail: 'Within current scope' },
    ],
    period: periodLabel,
  }

  return {
    data: {
      periodLabel,
      kpis: scaledKpis,
      revenueTrend: { series: scaledSlice, annotations },
      channelMix,
      hourWeekday,
      topBottomDishes,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: 'Sample dataset — values are deterministically scaled to the selected scope.',
    },
    insight,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Compact PKR formatter for adapter-derived insight sentences. */
function compactPkr(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `PKR ${round1(n / 1e6)}M`
  if (abs >= 1e3) return `PKR ${Math.round(n / 1e3)}K`
  return `PKR ${Math.round(n)}`
}

/** Deterministic ±spread multiplier derived from a string seed (never random). */
function seedNoise(seed: string, spread = 0.2): number {
  return 1 - spread / 2 + (hash(seed) % 1000) / 1000 * spread
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function median(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Item rows filtered by category and scaled to the selected scope. */
function scopedItems(filters: GlobalFilters, scope: ReturnType<typeof resolveScope>): MenuItem[] {
  return menuMock.data.items
    .filter((i) => !filters.category || i.categoryId === filters.category)
    .map((i) => ({
      ...i,
      revenue: r(i.revenue * scope.rangeScale * scope.locScale),
      quantity: r(i.quantity * scope.rangeScale * scope.locScale),
    }))
}

function scopePeriodLabel(scope: ReturnType<typeof resolveScope>): string {
  return `${shortLabel(scope.sliceStart)} – ${shortLabel(scope.sliceEnd)}, ${new Date(`${scope.sliceEnd}T00:00:00`).getFullYear()}`
}

function handleMenuItems(filters: GlobalFilters): MenuItemsResponse {
  const scope = resolveScope(filters)
  const items = scopedItems(filters, scope)
  return {
    data: { items },
    meta: { ...menuMock.meta, generatedAt: new Date().toISOString() },
  }
}

/* ------------------------ menu summary (Phase 2) -------------------------- */

/**
 * Derives the Menu Intelligence payload from the SAME item rows served by
 * /api/menu/items — the mock backend's aggregation query. Medians, quadrant
 * flags, class distribution and tricky-case rules are deterministic; every
 * sentence in the insight is computed from THIS response's values.
 */
function deriveMenuSummary(items: MenuItem[], periodLabel: string): MenuSummaryResponse {
  const totalQty = items.reduce((s, i) => s + i.quantity, 0) || 1
  const revenueSum = items.reduce((s, i) => s + i.revenue, 0) || 1
  const margins = items.map((i) => i.marginPct)
  const medianMargin = round1(median([...margins].sort((a, b) => a - b)))
  const medianPopularity = round4(
    median([...items.map((i) => i.quantity / totalQty)].sort((a, b) => a - b)),
  )

  const points: MenuScatterPoint[] = items.map((i) => ({
    itemId: i.itemId,
    name: i.name,
    category: i.category,
    categoryId: i.categoryId,
    popularityShare: round4(i.quantity / totalQty),
    marginPct: i.marginPct,
    revenue: i.revenue,
    quantity: i.quantity,
    rating: i.rating,
    trendPct: i.trendPct,
    performanceClass: i.performanceClass,
    inQuadrantStar: i.quantity / totalQty >= medianPopularity && i.marginPct >= medianMargin,
  }))

  const CLASS_ORDER: PerformanceClass[] = [
    'profit_driver',
    'volume_driver',
    'hidden_opportunity',
    'low_performer',
  ]
  const classDistribution = CLASS_ORDER.map((c) => {
    const rows = items.filter((i) => i.performanceClass === c)
    const rev = rows.reduce((s, i) => s + i.revenue, 0)
    return {
      performanceClass: c,
      count: rows.length,
      revenue: rev,
      revenueShare: round2(rev / revenueSum),
    }
  })

  const kpis: MenuKpis = {
    itemsTracked: items.length,
    revenueCoverage: menuMock.meta.coverageOfRevenue ?? 0.78,
    avgMarginPct: round1(margins.reduce((s, m) => s + m, 0) / (margins.length || 1)),
    avgRating: round1(items.reduce((s, i) => s + i.rating, 0) / (items.length || 1)),
    promoDependentItems: items.filter((i) => i.promoDependencyPct > 50).length,
    wastagePct: round1(
      items.reduce((s, i) => s + i.wastagePct * i.revenue, 0) / revenueSum,
    ),
  }

  /* Tricky cases — deterministic watchlist rules (backend thresholds):
     promo dependency > 50% · wastage ≥ 8% · rating ≤ 3.4 while popular ·
     fading star (trend ≤ −10% with above-median margin) · margin ≥ 55%. */
  const cases: MenuCase[] = []
  for (const i of items) {
    if (i.promoDependencyPct > 50) {
      cases.push({
        id: `case-promo-${i.itemId}`,
        caseType: 'promo_dependency',
        severity: 'high',
        itemId: i.itemId,
        itemName: i.name,
        headline: `${Math.round(i.promoDependencyPct)}% of ${i.name} volume is promo-driven`,
        detail:
          'Volume collapses without discounting; contribution per order falls on promo days.',
        evidence: [
          { metric: 'Promo dependency', value: `${i.promoDependencyPct}%`, detail: 'Share of volume sold on discount' },
          { metric: 'Margin', value: `${i.marginPct}%`, detail: 'Price below category median' },
          { metric: '90-day trend', value: `${i.trendPct > 0 ? '+' : ''}${i.trendPct}%`, detail: 'Quantity trend' },
        ],
      })
    }
    if (i.wastagePct >= 8) {
      cases.push({
        id: `case-wastage-${i.itemId}`,
        caseType: 'high_wastage',
        severity: i.wastagePct >= 12 ? 'high' : 'medium',
        itemId: i.itemId,
        itemName: i.name,
        headline: `${i.name} wastes ${i.wastagePct}% of prepared volume`,
        detail: 'Preparation batches exceed demand; right-sizing recovers contribution directly.',
        evidence: [
          { metric: 'Wastage', value: `${i.wastagePct}%`, detail: `National average: ${kpis.wastagePct}%` },
          { metric: 'Wasted revenue equiv.', value: `PKR ${Math.round((i.wastagePct / 100) * i.revenue / 1000)}K`, detail: 'Trailing 30 days' },
          { metric: 'Margin', value: `${i.marginPct}%`, detail: 'Recovered volume lands at this margin' },
        ],
      })
    }
    if (i.rating <= 3.4 && i.quantity / totalQty >= medianPopularity) {
      cases.push({
        id: `case-rating-${i.itemId}`,
        caseType: 'rating_risk',
        severity: 'medium',
        itemId: i.itemId,
        itemName: i.name,
        headline: `${i.name} sells above-median volume at a ${i.rating} rating`,
        detail: 'Popularity is outpacing quality; rating drag puts repeat orders at risk.',
        evidence: [
          { metric: 'Rating', value: `${i.rating} / 5`, detail: 'Menu median is higher' },
          { metric: 'Popularity', value: `${round2((i.quantity / totalQty) * 100)}%`, detail: 'Share of tracked quantity sold' },
          { metric: 'Repeat rate', value: `${i.repeatRatePct}%`, detail: 'Customers reordering the item' },
        ],
      })
    }
    if (i.trendPct <= -10 && i.marginPct >= medianMargin) {
      cases.push({
        id: `case-fading-${i.itemId}`,
        caseType: 'fading_star',
        severity: 'medium',
        itemId: i.itemId,
        itemName: i.name,
        headline: `${i.name} margin is ${i.marginPct}% but volume is fading (${i.trendPct}%)`,
        detail: 'High-margin item losing traffic — placement or visibility fix before price action.',
        evidence: [
          { metric: '90-day trend', value: `${i.trendPct}%`, detail: 'Quantity trend' },
          { metric: 'Margin', value: `${i.marginPct}%`, detail: 'Above the menu median' },
          { metric: 'Menu median margin', value: `${medianMargin}%`, detail: 'Reference for placement decisions' },
        ],
      })
    }
    if (i.marginPct >= 55) {
      cases.push({
        id: `case-margin-${i.itemId}`,
        caseType: 'margin_outlier',
        severity: 'low',
        itemId: i.itemId,
        itemName: i.name,
        headline: `${i.name} margin of ${i.marginPct}% leads the menu`,
        detail: 'Under-visible high-margin item — candidate for menu placement and upsell prompts.',
        evidence: [
          { metric: 'Margin', value: `${i.marginPct}%`, detail: 'Highest margin tier' },
          { metric: 'Popularity', value: `${round2((i.quantity / totalQty) * 100)}%`, detail: 'Share of tracked quantity sold' },
          { metric: 'Price', value: `PKR ${i.price}`, detail: 'Low ticket — easy attachment' },
        ],
      })
    }
  }
  const SEV = { high: 0, medium: 1, low: 2 } as const
  cases.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.id.localeCompare(b.id))

  const stars = points.filter((p) => p.inQuadrantStar).length
  const wastageCases = cases.filter((c) => c.caseType === 'high_wastage').length
  const worstWastage = [...items].sort((a, b) => b.wastagePct - a.wastagePct)[0]

  return {
    data: {
      periodLabel,
      kpis,
      scatter: {
        points,
        medianPopularityShare: medianPopularity,
        medianMarginPct: medianMargin,
        quadrantLabels: {
          high: 'Above medians — protect & feature',
          low: 'Below medians — fix or retire',
        },
      },
      classDistribution,
      trickyCases: cases,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Derived live from the item-level sample dataset for the selected scope.',
    },
    insight: {
      summary: [
        `${items.length} tracked items cover ${Math.round(kpis.revenueCoverage * 100)}% of national revenue with a mean margin of ${kpis.avgMarginPct}% and a mean rating of ${kpis.avgRating} / 5 for ${periodLabel}.`,
        `${stars} items clear both the popularity and margin medians; ${kpis.promoDependentItems} depend on promotions for the majority of their volume.`,
        worstWastage
          ? `${worstWastage.name} runs the highest wastage at ${worstWastage.wastagePct}% — ${wastageCases} item${wastageCases === 1 ? '' : 's'} breach the 8% wastage watch threshold.`
          : 'No item breaches the 8% wastage watch threshold in the current scope.',
      ],
      whyItMatters:
        'The popularity × margin quadrants separate items that deserve visibility from items that erode contribution; the tricky-case watchlist names the specific lever — promotion depth, prep batch size or menu placement — behind every flagged item.',
      evidence: [
        { metric: 'Items tracked', value: String(items.length), detail: 'Sample subset of the production menu' },
        { metric: 'Above both medians', value: String(stars), detail: 'Protect, feature and bundle these first' },
        { metric: 'Watchlist cases', value: String(cases.length), detail: 'Backend-flagged, evidence attached' },
      ],
      period: periodLabel,
    },
  }
}

function handleMenuSummary(filters: GlobalFilters): MenuSummaryResponse {
  const scope = resolveScope(filters)
  const items = scopedItems(filters, scope)
  const response = deriveMenuSummary(items, scopePeriodLabel(scope))
  return {
    ...response,
    meta: {
      ...response.meta,
      filters: filters as Record<string, unknown>,
    },
  }
}

/* ------------- recommendation status mutations (Phase 2) ------------------ */

/** Session-scoped status store — mirrors what a real POST would persist. */
const recommendationStatusOverrides = new Map<string, Recommendation['status']>()

function handleRecommendations(filters: GlobalFilters & { priority?: string; status?: string }): RecommendationsResponse {
  let recs = [...recommendationsMock.data.recommendations].map(
    (rec) =>
      recommendationStatusOverrides.get(rec.id)
        ? { ...rec, status: recommendationStatusOverrides.get(rec.id)! }
        : rec,
  )
  if (filters.priority && filters.priority !== 'all') recs = recs.filter((x) => x.priority === filters.priority)
  if (filters.status && filters.status !== 'all') recs = recs.filter((x) => x.status === filters.status)
  if (filters.location) recs = recs.filter((x) => !x.outletId || x.outletId === filters.location)
  if (filters.category) recs = recs.filter((x) => !x.categoryId || x.categoryId === filters.category)
  return {
    data: { recommendations: recs },
    meta: { ...recommendationsMock.meta, generatedAt: new Date().toISOString() },
  }
}

function handleRecommendationStatus(id: string, body: unknown): RecommendationStatusResponse {
  const { status } = (body ?? {}) as { status?: Recommendation['status'] }
  if (status !== 'new' && status !== 'acknowledged' && status !== 'dismissed') {
    throw new ApiError('Invalid status. Use new, acknowledged or dismissed.', 422, 'no_data', `/api/recommendations/${id}/status`)
  }
  const rec = recommendationsMock.data.recommendations.find((x) => x.id === id)
  if (!rec) {
    throw new ApiError(`Recommendation ${id} does not exist.`, 404, 'not_found', `/api/recommendations/${id}/status`)
  }
  recommendationStatusOverrides.set(id, status)
  return {
    data: { recommendation: { ...rec, status } },
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Mock session state — status changes persist until the page is reloaded.',
    },
  }
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const

function handleAnomalies(filters: GlobalFilters & { limit?: number }): AnomaliesResponse {
  // Session status overrides first (same semantics as the recommendations POST store).
  let list = [...anomaliesMock.data.anomalies].map(
    (a) => (anomalyOverrides.get(a.id) ? { ...a, status: anomalyOverrides.get(a.id)! } : a),
  )
  if (filters.location) {
    const outlet = locationsMock.data.outlets.find((o) => o.id === filters.location)
    if (outlet) {
      list = list.filter(
        (a) =>
          !outlet.name ||
          a.dimensionRef === outlet.name ||
          a.dimensionRef === 'Nationwide' ||
          a.dimension !== 'outlet',
      )
    }
  }
  list.sort((a, b) => {
    const d = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (d !== 0) return d
    return b.detectedAt.localeCompare(a.detectedAt)
  })
  const limit = filters.limit
  if (limit && limit > 0) list = list.slice(0, limit)
  return {
    data: { anomalies: list },
    meta: { ...anomaliesMock.meta, generatedAt: new Date().toISOString() },
  }
}

/* ------------------- what-if simulation engine (Phase 2) ------------------ */

/**
 * Deterministic What-If arithmetic (spec §27) — the mock twin of the backend
 * ScenarioEngine. Same input ALWAYS yields the same output; no randomness.
 *
 * Model (all parameters from whatif-config.json, i.e. the model registry):
 *   demandFactor = (1 + elasticity · Δprice%) · (1 + discount lift)
 *   discount lift saturates above fatigueAbovePct (fatigue dampener)
 *   prep shortfall converts to lost sales at shortfallConversion
 *   unit cost is held constant; scenario margin follows the new price
 *
 * Every response carries `estimate: true` — the UI must label it
 * "ESTIMATE — NOT ACTUAL RESULTS" (integrity rule 5).
 */
function handleWhatIf(body: unknown, filters: GlobalFilters): WhatIfResponse {
  const input = (body ?? {}) as Partial<WhatIfScenarioInput>
  const fail: (message: string) => never = (message) => {
    throw new ApiError(message, 422, 'no_data', endpoints_whatif)
  }

  const priceChangePct = Number(input.priceChangePct ?? 0)
  const discountPct = Number(input.discountPct ?? 0)
  const prepChangePct = Number(input.prepChangePct ?? 0)
  const horizonDays = Number(input.horizonDays ?? 7)
  const limits = whatifConfig.limits

  if (!input.itemId || typeof input.itemId !== 'string') fail('Select a menu item to simulate.')
  if (!Number.isFinite(priceChangePct) || priceChangePct < limits.priceChangePct[0] || priceChangePct > limits.priceChangePct[1]) {
    fail(`Price change must be between ${limits.priceChangePct[0]}% and ${limits.priceChangePct[1]}%.`)
  }
  if (!Number.isFinite(discountPct) || discountPct < limits.discountPct[0] || discountPct > limits.discountPct[1]) {
    fail(`Discount must be between ${limits.discountPct[0]}% and ${limits.discountPct[1]}%.`)
  }
  if (!Number.isFinite(prepChangePct) || prepChangePct < limits.prepChangePct[0] || prepChangePct > limits.prepChangePct[1]) {
    fail(`Preparation change must be between ${limits.prepChangePct[0]}% and ${limits.prepChangePct[1]}%.`)
  }
  if (!limits.horizonDays.includes(horizonDays)) fail('Horizon must be 7, 14 or 30 days.')

  const item = menuMock.data.items.find((i) => i.itemId === input.itemId)
  if (!item) fail('Unknown menu item for the supplied itemId.')

  const scope = resolveScope(filters)
  const elasticity = whatifConfig.categories[item.categoryId]?.elasticity ?? -1.0
  const outlet = filters.location ? locationsMock.data.outlets.find((o) => o.id === filters.location) : undefined

  /* Baseline: trailing 30-day window scaled to the selected scope + horizon. */
  const horizonFactor = horizonDays / 30
  const baselineQty = Math.max(1, item.quantity * scope.rangeScale * scope.locScale * horizonFactor)
  const baselinePrice = item.price
  const unitCost = baselinePrice * (1 - item.marginPct / 100)
  const baselineRevenue = baselineQty * baselinePrice
  const baselineProfit = (baselinePrice - unitCost) * baselineQty
  const baselineMargin = item.marginPct

  /* Scenario demand: price elasticity × discount lift (with fatigue). */
  const priceDemandFactor = 1 + (elasticity * priceChangePct) / 100
  const liftPer10 = whatifConfig.discount.liftPer10Pct / 10 / 100
  let discountLift = discountPct * liftPer10
  if (discountPct > whatifConfig.discount.fatigueAbovePct) {
    const fullPart = whatifConfig.discount.fatigueAbovePct * liftPer10
    const dampedPart =
      (discountPct - whatifConfig.discount.fatigueAbovePct) * liftPer10 * whatifConfig.discount.fatigueDampener
    discountLift = fullPart + dampedPart
  }
  const prepShortfall =
    prepChangePct < 0
      ? Math.min(-prepChangePct / 100, 0.99) * whatifConfig.prep.shortfallConversion
      : 0

  const demandFactor = Math.max(priceDemandFactor, 0.05) * (1 + discountLift)
  const scenarioQty = Math.max(0, baselineQty * demandFactor * (1 - prepShortfall))
  const scenarioPrice = baselinePrice * (1 + priceChangePct / 100) * (1 - discountPct / 100)
  const scenarioRevenue = scenarioQty * scenarioPrice
  const scenarioProfit = (scenarioPrice - unitCost) * scenarioQty
  const scenarioMargin = scenarioRevenue > 0 ? (scenarioProfit / scenarioRevenue) * 100 : 0

  const pct = (b: number, s: number) => (b !== 0 ? round2(((s - b) / Math.abs(b)) * 100) : 0)
  const dir = (b: number, s: number): WhatIfDeltaDirection => (s > b ? 'increase' : s < b ? 'decrease' : 'flat')
  const fav = (b: number, s: number): WhatIfDelta['favorability'] =>
    s > b ? 'positive' : s < b ? 'negative' : 'neutral'
  const favNeutral = (b: number, s: number): WhatIfDelta['favorability'] =>
    s === b ? 'neutral' : 'neutral'

  const deltas: WhatIfDelta[] = [
    { metric: 'Revenue', baseline: baselineRevenue, scenario: scenarioRevenue, deltaPct: pct(baselineRevenue, scenarioRevenue), direction: dir(baselineRevenue, scenarioRevenue), favorability: fav(baselineRevenue, scenarioRevenue) },
    { metric: 'Contribution profit', baseline: baselineProfit, scenario: scenarioProfit, deltaPct: pct(baselineProfit, scenarioProfit), direction: dir(baselineProfit, scenarioProfit), favorability: fav(baselineProfit, scenarioProfit) },
    { metric: 'Items sold', baseline: baselineQty, scenario: scenarioQty, deltaPct: pct(baselineQty, scenarioQty), direction: dir(baselineQty, scenarioQty), favorability: 'neutral' },
    { metric: 'Contribution margin', baseline: baselineMargin, scenario: round1(scenarioMargin), deltaPct: pct(baselineMargin, scenarioMargin), direction: dir(baselineMargin, scenarioMargin), favorability: fav(baselineMargin, scenarioMargin) },
    { metric: 'Effective price', baseline: baselinePrice, scenario: Math.round(scenarioPrice), deltaPct: pct(baselinePrice, scenarioPrice), direction: dir(baselinePrice, scenarioPrice), favorability: favNeutral(baselinePrice, scenarioPrice) },
  ]

  const notes: string[] = [...whatifConfig.notes]
  if (discountPct > whatifConfig.discount.fatigueAbovePct) {
    notes.push(
      `Discount exceeds ${whatifConfig.discount.fatigueAbovePct}% — demand lift beyond that level is damped by promotion fatigue (factor ${whatifConfig.discount.fatigueDampener}).`,
    )
  }
  if (prepChangePct < 0) {
    notes.push(
      `Preparation runs ${Math.round(-prepChangePct)}% below baseline; an estimated ${Math.round(prepShortfall * 100)}% of demand converts to lost sales at the shortfall conversion rate.`,
    )
  }
  if (scenarioMargin < 0) {
    notes.push('Scenario margin is negative — the discounted price no longer covers the unit cost of this item.')
  }

  const scopeBits = [
    outlet ? outlet.name : 'All outlets',
    filters.category ? item.category : 'All categories',
  ]
  const scopeLabel = `${scopePeriodLabel(scope)} · ${scopeBits.join(' · ')}`

  const revenueDelta = deltas[0]
  const profitDelta = deltas[1]
  const fmtPkr = (n: number) => (Math.abs(n) >= 1e6 ? `PKR ${round2(n / 1e6)}M` : `PKR ${Math.round(n / 1e3)}K`)

  return {
    data: {
      estimate: true,
      itemId: item.itemId,
      itemName: item.name,
      category: item.category,
      scopeLabel,
      horizonDays,
      baseline: {
        price: baselinePrice,
        quantity: Math.round(baselineQty),
        revenue: Math.round(baselineRevenue),
        profit: Math.round(baselineProfit),
        marginPct: baselineMargin,
      },
      scenario: {
        price: Math.round(scenarioPrice),
        quantity: Math.round(scenarioQty),
        revenue: Math.round(scenarioRevenue),
        profit: Math.round(scenarioProfit),
        marginPct: round1(scenarioMargin),
      },
      deltas,
      assumptions: whatifConfig.assumptions,
      notes,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      modelName: whatifConfig.model.name,
      modelVersion: whatifConfig.model.version,
      pipeline: whatifConfig.model.pipeline,
      filters: filters as Record<string, unknown>,
      note: 'ESTIMATE — NOT ACTUAL RESULTS. Deterministic scenario arithmetic on the sample dataset.',
    },
    insight: {
      summary: [
        `The scenario is estimated to move revenue ${revenueDelta.deltaPct > 0 ? '+' : ''}${revenueDelta.deltaPct}% (${fmtPkr(revenueDelta.baseline)} → ${fmtPkr(revenueDelta.scenario)}) and contribution profit ${profitDelta.deltaPct > 0 ? '+' : ''}${profitDelta.deltaPct}% over ${horizonDays} days versus baseline.`,
        elasticity < -1
          ? `Demand in ${item.category} is price-elastic (elasticity ${elasticity}) — volume shifts amplify price changes.`
          : `Demand in ${item.category} is comparatively inelastic (elasticity ${elasticity}) — volume shifts are smaller than the price change.`,
      ],
      whyItMatters:
        'Simulated levers interact: a price rise can be erased by the discount needed to defend volume, so contribution profit — not revenue — is the deciding metric for this scenario.',
      evidence: [
        { metric: 'Elasticity applied', value: String(elasticity), detail: `Category-level estimate for ${item.category}` },
        { metric: 'Demand factor', value: `${round2(demandFactor * 100)}%`, detail: 'Price and discount effects combined' },
        prepShortfall > 0
          ? { metric: 'Prep shortfall', value: `${Math.round(prepShortfall * 100)}%`, detail: 'Demand converted to lost sales' }
          : { metric: 'Prep level', value: 'No shortfall', detail: 'Supply covers simulated demand' },
      ],
      period: `${horizonDays}-day horizon`,
    },
  }
}

const endpoints_whatif = '/api/whatif/simulate'

/* ====================== PHASE 3–5 HANDLERS ================================ */

/**
 * Customers overview (Phase 3). Customer counts scale sub-linearly with the
 * window (people order less than every day) and follow the outlet scope;
 * revenue fields scale with the full combined scope factor. Canonical scope
 * serves the stored payload verbatim including its period insight.
 */
function handleCustomers(filters: GlobalFilters): CustomerOverviewResponse {
  const scope = resolveScope(filters)
  if (scope.isCanonical) {
    return { ...customersMock, meta: { ...customersMock.meta, generatedAt: new Date().toISOString() } }
  }
  const base = customersMock.data
  const countScale = Math.pow(scope.rangeScale, 0.85) * scope.locScale * Math.sqrt(scope.catScale) * Math.sqrt(scope.channelScale)
  const revenueScale = scope.rangeScale * scope.locScale * scope.catScale * scope.channelScale
  const rInt = (n: number) => Math.max(0, Math.round(n * countScale))
  const periodLabel = scopePeriodLabel(scope)

  const kpis = {
    totalCustomers: rInt(base.kpis.totalCustomers),
    activeCustomers: rInt(base.kpis.activeCustomers),
    newCustomers: rInt(base.kpis.newCustomers),
    repeatRatePct: base.kpis.repeatRatePct,
    avgLifetimeValue: Math.round(base.kpis.avgLifetimeValue),
    avgOrdersPerCustomer: base.kpis.avgOrdersPerCustomer,
    highChurnRisk: rInt(base.kpis.highChurnRisk),
    revenueAtRisk: Math.round(base.kpis.revenueAtRisk * revenueScale),
  }
  const segments = base.segments.map((s) => ({
    ...s,
    customers: rInt(s.customers),
    revenue: Math.round(s.revenue * revenueScale),
  }))
  const rfmTiers = base.rfmTiers.map((t) => ({
    ...t,
    customers: rInt(t.customers),
    revenue: Math.round(t.revenue * revenueScale),
  }))
  const churnRisk = base.churnRisk.map((c) => ({
    ...c,
    customers: rInt(c.customers),
    revenueAtRisk: Math.round(c.revenueAtRisk * revenueScale),
  }))
  const topCustomers = base.topCustomers.slice(0, Math.max(6, Math.round(24 * Math.min(1, countScale * 1.4))))
  const segShare = segments.reduce((s, x) => s + x.revenue, 0) || 1
  const topSeg = [...segments].sort((a, b) => b.revenue - a.revenue)[0]

  return {
    data: { ...base, periodLabel, kpis, segments, rfmTiers, churnRisk, topCustomers },
    meta: {
      ...customersMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: 'Sample dataset — customer counts scale sub-linearly with the selected window.',
    },
    insight: {
      summary: [
        `${kpis.activeCustomers.toLocaleString('en-US')} customers ordered in the selected scope with a ${kpis.repeatRatePct}% repeat rate; ${kpis.highChurnRisk.toLocaleString('en-US')} sit in the model's high churn-risk bucket.`,
        `${topSeg.label} is the largest revenue segment in scope at ${round2((topSeg.revenue / segShare) * 100)}% of segment revenue.`,
        `Revenue attributed to high-risk customers is ${compactPkr(kpis.revenueAtRisk)} — the win-back shortlist is ordered by lifetime value below.`,
      ],
      evidence: [
        { metric: 'Active customers', value: kpis.activeCustomers.toLocaleString('en-US'), detail: 'Within current scope' },
        { metric: 'High churn risk', value: kpis.highChurnRisk.toLocaleString('en-US'), detail: 'ChurnScorer flags' },
      ],
      period: periodLabel,
    },
  }
}

/** Basket analysis (Phase 3). Pair/basket counts scale with the scope; shares, lift and confidence are scope-invariant. */
function handleBasket(filters: GlobalFilters): BasketAnalysisResponse {
  const scope = resolveScope(filters)
  const base = basketMock.data
  if (scope.isCanonical) {
    return { ...basketMock, meta: { ...basketMock.meta, generatedAt: new Date().toISOString() } }
  }
  const scale = scope.rangeScale * scope.locScale * scope.catScale * scope.channelScale
  const periodLabel = scopePeriodLabel(scope)
  const rules = base.rules.map((r) => ({ ...r, pairOrders: Math.round(r.pairOrders * scale) }))
  const strongRules = rules.filter((r) => r.lift >= 1.5 && r.supportPct >= 2).length
  const kpis = {
    ...base.kpis,
    basketsAnalyzed: Math.round(base.kpis.basketsAnalyzed * scale),
    avgBasketValue: base.kpis.avgBasketValue,
    strongRules,
  }
  const topRule = [...rules].sort((a, b) => b.lift - a.lift)[0]

  return {
    data: {
      ...base,
      periodLabel,
      kpis,
      rules,
      categoryPairs: base.categoryPairs.map((p) => ({ ...p, pairOrders: Math.round(p.pairOrders * scale) })),
      basketSizeDist: base.basketSizeDist.map((b) => ({ ...b, baskets: Math.round(b.baskets * scale) })),
    },
    meta: {
      ...basketMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: 'Sample dataset — pair counts scale with the selected scope; lift and confidence are scope-invariant.',
    },
    insight: {
      summary: [
        `${kpis.basketsAnalyzed.toLocaleString('en-US')} baskets analyzed in the current scope; the strongest surviving pairing is ${topRule.antecedent.name} → ${topRule.consequent.name} at ${topRule.lift}× lift.`,
        `${strongRules} of ${rules.length} rules clear lift ≥ 1.5 and support ≥ 2%; ${base.bundles.length} bundle suggestions remain backed by rules in scope.`,
        'Lift and confidence are structural — they do not rescale with filters; only pair frequencies do.',
      ],
      evidence: [
        { metric: 'Baskets analyzed', value: kpis.basketsAnalyzed.toLocaleString('en-US'), detail: 'Within current scope' },
        { metric: 'Strong rules', value: String(strongRules), detail: 'lift ≥ 1.5 · support ≥ 2%' },
      ],
      period: periodLabel,
    },
  }
}

/**
 * Demand forecast (Phase 3). History is sliced to the selected range and
 * scaled to the outlet/category/channel scope; the 14-day forward forecast is
 * always appended after the window end (a forecast horizon is relative to
 * "now", not to the historical filter).
 */
function handleForecast(filters: GlobalFilters): ForecastOverviewResponse {
  const scope = resolveScope(filters)
  const base = forecastMock.data
  const history = base.daily.filter((d) => !d.isForecast && d.date >= scope.sliceStart && d.date <= scope.sliceEnd)
  const forward = base.daily.filter((d) => d.isForecast)
  const scale = scope.locScale * scope.catScale * scope.channelScale
  const periodLabel = scopePeriodLabel(scope)

  const daily = [
    ...history.map((d) => ({
      ...d,
      actual: Math.round((d.actual ?? 0) * scale),
      forecast: Math.round(d.forecast * scale),
      lower: Math.round(d.lower * scale),
      upper: Math.round(d.upper * scale),
    })),
    ...forward.map((d) => ({
      ...d,
      forecast: Math.round(d.forecast * scale),
      lower: Math.round(d.lower * scale),
      upper: Math.round(d.upper * scale),
    })),
  ]
  const forecastOrders = forward.reduce((s, d) => s + Math.round(d.forecast * scale), 0)
  const items = base.items.map((i) => ({
    ...i,
    actualQty: Math.round(i.actualQty * scale),
    forecastQty: Math.round(i.forecastQty * scale),
  }))
  const rising = items.filter((i) => i.trend === 'rising').length
  const scopeNote = scale !== 1 ? 'Quantities scaled to the selected scope.' : 'National scope.'

  return {
    data: { ...base, periodLabel, kpis: { ...base.kpis, forecastOrders, forecastRevenue: Math.round(forecastOrders * aovOf()) }, daily, items },
    meta: {
      ...forecastMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: scopeNote,
    },
    insight: {
      summary: [
        `The model forecasts ${forecastOrders.toLocaleString('en-US')} orders over the next ${base.kpis.horizonDays} days for the current scope.`,
        `Backtest MAPE is ${base.kpis.mapePct}% with a ${base.kpis.biasPct > 0 ? '+' : ''}${base.kpis.biasPct}% bias — anchor procurement on the lower band when in doubt.`,
        `${rising} of ${items.length} tracked items are forecast to rise; accuracy table below compares the two engines against a naive baseline.`,
      ],
      evidence: [
        { metric: 'Forecast orders', value: forecastOrders.toLocaleString('en-US'), detail: `${base.kpis.horizonDays}-day horizon` },
        { metric: 'Backtest MAPE', value: `${base.kpis.mapePct}%`, detail: 'DemandForecaster v3.2' },
      ],
      period: periodLabel,
    },
  }
}

/** AOV helper — derived from the KPI payload so forecast revenue stays consistent. */
function aovOf(): number {
  const revenue = kpisMock.data.kpis.find((k) => k.id === 'revenue')?.value ?? 0
  const orders = kpisMock.data.kpis.find((k) => k.id === 'orders')?.value ?? 0
  return orders > 0 ? revenue / orders : 0
}

/** Wastage overview (Phase 3). Costs scale with the combined scope; percentages are scope-invariant. */
function handleWastage(filters: GlobalFilters): WastageOverviewResponse {
  const scope = resolveScope(filters)
  const base = wastageMock.data
  if (scope.isCanonical) {
    return { ...wastageMock, meta: { ...wastageMock.meta, generatedAt: new Date().toISOString() } }
  }
  const scale = scope.rangeScale * scope.locScale * scope.catScale * scope.channelScale
  const periodLabel = scopePeriodLabel(scope)

  const trend = base.trend
    .filter((p) => p.date >= scope.sliceStart && p.date <= scope.sliceEnd)
    .map((p) => ({ ...p, wastageCost: Math.round(p.wastageCost * scale) }))
  const trendSum = trend.reduce((s, p) => s + p.wastageCost, 0)
  const byCategory = base.byCategory
    .filter((c) => !filters.category || c.categoryId === filters.category)
    .map((c) => ({ ...c, wastageCost: Math.round(c.wastageCost * scale) }))
  const byOutlet = base.byOutlet
    .filter((o) => !filters.location || o.outletId === filters.location)
    .map((o) => ({ ...o, wastageCost: Math.round(o.wastageCost * scale) }))
  const costSum = byCategory.reduce((s, c) => s + c.wastageCost, 0)
  const byItem = base.byItem
    .filter((i) => !filters.category || i.category === base.byCategory.find((c) => c.categoryId === filters.category)?.category)
    .map((i) => ({ ...i, wastageCost: Math.round(i.wastageCost * scale) }))

  const worstCat = [...byCategory].sort((a, b) => b.wastagePct - a.wastagePct)[0]
  const worstOut = [...byOutlet].sort((a, b) => b.wastagePct - a.wastagePct)[0]

  return {
    data: {
      periodLabel,
      kpis: {
        ...base.kpis,
        wastageCost: costSum || Math.round(base.kpis.wastageCost * scale),
        worstCategory: worstCat?.category ?? base.kpis.worstCategory,
        worstOutlet: worstOut?.outlet ?? base.kpis.worstOutlet,
      },
      trend: trend.length > 0 ? trend : base.trend.map((p) => ({ ...p, wastageCost: Math.round(p.wastageCost * scale) })),
      byCategory,
      byItem: byItem.length > 0 ? byItem : base.byItem.map((i) => ({ ...i, wastageCost: Math.round(i.wastageCost * scale) })),
      byOutlet,
    },
    meta: {
      ...wastageMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: 'Sample dataset — costs scale with the selected scope; percentages stay structural.',
    },
    insight: {
      summary: [
        `Wastage cost in the current scope is ${compactPkr(costSum || Math.round(base.kpis.wastageCost * scale))} across ${trend.length} tracked days${trendSum ? '' : ''}.`,
        worstCat ? `${worstCat.category} leads category wastage at ${worstCat.wastagePct}% (led by ${worstCat.topItem}).` : base.kpis.worstCategory,
        worstOut ? `${worstOut.outlet} is the worst outlet in scope at ${worstOut.wastagePct}%.` : base.kpis.worstOutlet,
      ],
      evidence: [
        { metric: 'Wastage cost', value: compactPkr(costSum || Math.round(base.kpis.wastageCost * scale)), detail: 'Within current scope' },
        { metric: 'Share of wastage', value: 'Over-prep 58% · spoilage 27%', detail: 'Structural split from the backend' },
      ],
      period: periodLabel,
    },
  }
}

/** Pricing & promotions (Phase 4). Elasticity and verdicts are model outputs — only revenue-at-stake scales. */
function handlePricing(filters: GlobalFilters): PricingPromoResponse {
  const scope = resolveScope(filters)
  const base = pricingMock.data
  const scale = scope.rangeScale * scope.locScale * scope.catScale * scope.channelScale
  const elasticity = base.elasticity.filter(
    (e) => !filters.category || e.category === base.elasticity.find((x) => x.itemId === e.itemId)?.category,
  )
  const rows = base.elasticity.filter((e) => {
    if (!filters.category) return true
    const catName = base.elasticity.find((x) => x.itemId === e.itemId)?.category
    const target = menuMock.data.items.find((i) => i.categoryId === filters.category)?.category
    return catName === target
  })
  void elasticity
  const kpis = { ...base.pricingKpis, revenueAtStake: Math.round(base.pricingKpis.revenueAtStake * scale), itemsAnalyzed: rows.length }
  const testCandidates = rows.filter((r) => r.recommendation === 'test').length
  return {
    data: {
      ...base,
      periodLabel: scopePeriodLabel(scope),
      pricingKpis: { ...kpis, testCandidates },
      elasticity: rows,
    },
    meta: {
      ...pricingMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: 'Elasticities and campaign verdicts are model estimates — they do not rescale with filters.',
    },
    insight: {
      summary: [
        `${rows.length} items scored for elasticity in scope: ${kpis.inelasticItems} inelastic (|e| < 1), ${testCandidates} A/B test candidates.`,
        `${base.promoKpis.positiveRoiCampaigns} of ${base.campaigns.length} campaigns clear ROI 1.0; ${base.promoKpis.trappedItems} items are promo traps with structural discount dependency.`,
        'Elasticities are category-model estimates — validate with the What-If Simulator before committing pricing moves.',
      ],
      evidence: [
        { metric: 'Inelastic items', value: String(kpis.inelasticItems), detail: 'Safe zone for measured increases' },
        { metric: 'Revenue at stake', value: compactPkr(kpis.revenueAtStake), detail: 'Within current scope' },
      ],
      period: scopePeriodLabel(scope),
    },
  }
}

/** Locations detail (Phase 4). Matrix values scale with the window; outlet structure is static. */
function handleLocationsDetail(filters: GlobalFilters): LocationsDetailResponse {
  const scope = resolveScope(filters)
  const base = locationsDetailMock.data
  if (scope.isCanonical) {
    return { ...locationsDetailMock, meta: { ...locationsDetailMock.meta, generatedAt: new Date().toISOString() } }
  }
  const scale = scope.rangeScale
  const outlet = filters.location ? locationsMock.data.outlets.find((o) => o.id === filters.location) : undefined
  const outletIds = outlet ? [outlet.id] : base.matrix.outletIds
  const outletNames = outlet ? [outlet.name] : base.matrix.outletNames
  const values = base.matrix.values
    .filter((v) => outletIds.includes(v.outletId))
    .map((v) => ({ ...v, revenue: Math.round(v.revenue * scale) }))
  const cityAggregates = base.cityAggregates
    .filter((c) => !filters.location || c.city === outlet?.city)
    .map((c) => ({ ...c, revenue: Math.round(c.revenue * scale) }))
  return {
    data: { ...base, periodLabel: scopePeriodLabel(scope), cityAggregates, matrix: { ...base.matrix, outletIds, outletNames, values } },
    meta: {
      ...locationsDetailMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: 'Matrix values scale with the selected window; outlet structure is static.',
    },
    insight: {
      summary: [
        `${outletIds.length} outlet${outletIds.length === 1 ? '' : 's'} in scope across ${cityAggregates.length} cit${cityAggregates.length === 1 ? 'y' : 'ies'} for ${scopePeriodLabel(scope)}.`,
        outlet ? `${outlet.name} generates ${compactPkr(outlet.revenue * scale)} (${Math.round(outlet.revenueShare * 100)}% share) with a ${outlet.profitMarginPct}% contribution margin.` : 'Select an outlet in the filter bar to focus the matrix on a single location.',
        `${base.kpis.flaggedOutlets} outlets carry performance flags — their evidence is attached in the comparison table.`,
      ],
      evidence: [
        { metric: 'Outlets in scope', value: String(outletIds.length), detail: 'Matrix rows' },
        { metric: 'Window', value: scopePeriodLabel(scope), detail: 'Matrix scaled to this window' },
      ],
      period: scopePeriodLabel(scope),
    },
  }
}

/** Channels hourly (Phase 4). Orders scale with the scope; the channel filter narrows rows. */
function handleChannelsHourly(filters: GlobalFilters): ChannelsHourlyResponse {
  const scope = resolveScope(filters)
  const base = channelsHourlyMock.data
  const scale = scope.rangeScale * scope.locScale * scope.catScale
  const channels = filters.channel ? base.channels.filter((c) => c.channel === filters.channel) : base.channels
  const values = base.values
    .filter((v) => channels.some((c) => c.channel === v.channel))
    .map((v) => ({ ...v, orders: Math.round(v.orders * scale) }))
  return {
    data: { ...base, channels, values },
    meta: {
      ...channelsHourlyMock.meta,
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
    },
  }
}

/** Anomaly status update (Phase 4) — session-scoped overrides, same contract as recommendations. */
const anomalyOverrides = new Map<string, Anomaly['status']>()

function handleAnomalyStatus(id: string, body: unknown): AnomalyStatusResponse {
  const { status } = (body ?? {}) as { status?: Anomaly['status'] }
  const VALID: Anomaly['status'][] = ['new', 'reviewing', 'resolved', 'dismissed']
  if (!status || !VALID.includes(status)) {
    throw new ApiError('status must be one of new | reviewing | resolved | dismissed.', 422, 'no_data', '/api/anomalies')
  }
  const anomaly = anomaliesMock.data.anomalies.find((a) => a.id === id)
  if (!anomaly) throw new ApiError(`Unknown anomaly: ${id}`, 404, 'not_found', '/api/anomalies')
  anomalyOverrides.set(id, status)
  return {
    data: { anomaly: { ...anomaly, status } },
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Mock mode: status overrides are session-scoped and reset on reload.',
    },
  }
}

/** Pipeline comparison (Phase 5) — parity audit is global; no scope scaling. */
function handleModels(): ModelComparisonResponse {
  return { ...modelsMock, meta: { ...modelsMock.meta, generatedAt: new Date().toISOString() } }
}

/** Reports catalog (Phase 5). */
function handleReportsCatalog(): ReportCatalogResponse {
  return { ...reportsMock, meta: { ...reportsMock.meta, generatedAt: new Date().toISOString() } }
}

/**
 * Report run (Phase 5). Returns a REAL row sample built from the same mock
 * datasets the pages consume — the frontend serializes them to CSV and never
 * invents rows. Samples are capped and flagged `truncated`.
 */
function handleReportRun(id: string, filters: GlobalFilters): ReportRunResponse {
  const def = reportsMock.data.reports.find((r) => r.id === id)
  if (!def) throw new ApiError(`Unknown report: ${id}`, 404, 'not_found', '/api/reports')
  const scope = resolveScope(filters)
  const scale = scope.rangeScale * scope.locScale

  const SAMPLE_CAP = 60
  const fmtPkr = (n: number) => (Math.abs(n) >= 1e6 ? `PKR ${round1(n / 1e6)}M` : `PKR ${Math.round(n / 1e3)}K`)
  let columns: { key: string; label: string }[] = []
  let rows: Record<string, string | number>[] = []
  let truncated = false

  switch (id) {
    case 'daily-revenue': {
      columns = [
        { key: 'date', label: 'Date' },
        { key: 'revenue', label: 'Revenue (PKR)' },
        { key: 'orders', label: 'Orders' },
        { key: 'aov', label: 'AOV (PKR)' },
      ]
      const slice = kpisMock.data.revenueTrend.series.filter((p) => p.date >= scope.sliceStart && p.date <= scope.sliceEnd)
      rows = slice.map((p) => ({
        date: p.date,
        revenue: Math.round(p.revenue * scale),
        orders: Math.round(p.orders * scale),
        aov: Math.round(p.revenue / Math.max(1, p.orders)),
      }))
      truncated = rows.length < def.rows
      break
    }
    case 'item-performance': {
      columns = [
        { key: 'itemId', label: 'Item ID' },
        { key: 'name', label: 'Item' },
        { key: 'category', label: 'Category' },
        { key: 'price', label: 'Price (PKR)' },
        { key: 'revenue', label: 'Revenue (PKR)' },
        { key: 'quantity', label: 'Quantity' },
        { key: 'marginPct', label: 'Margin %' },
        { key: 'performanceClass', label: 'Class' },
      ]
      rows = menuMock.data.items.map((i) => ({
        itemId: i.itemId,
        name: i.name,
        category: i.category,
        price: i.price,
        revenue: Math.round(i.revenue * scale),
        quantity: Math.round(i.quantity * scale),
        marginPct: i.marginPct,
        performanceClass: i.performanceClass,
      }))
      break
    }
    case 'basket-rules': {
      columns = [
        { key: 'antecedent', label: 'Antecedent' },
        { key: 'consequent', label: 'Consequent' },
        { key: 'supportPct', label: 'Support %' },
        { key: 'confidencePct', label: 'Confidence %' },
        { key: 'lift', label: 'Lift' },
        { key: 'pairOrders', label: 'Pair orders' },
      ]
      rows = basketMock.data.rules.map((r) => ({
        antecedent: r.antecedent.name,
        consequent: r.consequent.name,
        supportPct: r.supportPct,
        confidencePct: r.confidencePct,
        lift: r.lift,
        pairOrders: Math.round(r.pairOrders * scale),
      }))
      break
    }
    case 'demand-forecast': {
      columns = [
        { key: 'itemId', label: 'Item ID' },
        { key: 'name', label: 'Item' },
        { key: 'actualQty', label: 'Actual qty (7d)' },
        { key: 'forecastQty', label: 'Forecast qty (7d)' },
        { key: 'deltaPct', label: 'Delta %' },
        { key: 'confidence', label: 'Confidence' },
      ]
      rows = forecastMock.data.items.map((i) => ({
        itemId: i.itemId,
        name: i.name,
        actualQty: Math.round(i.actualQty * scale),
        forecastQty: Math.round(i.forecastQty * scale),
        deltaPct: i.deltaPct,
        confidence: i.confidence,
      }))
      break
    }
    case 'wastage-detail': {
      columns = [
        { key: 'itemId', label: 'Item ID' },
        { key: 'name', label: 'Item' },
        { key: 'category', label: 'Category' },
        { key: 'wastagePct', label: 'Wastage %' },
        { key: 'wastageCost', label: 'Wastage cost (PKR)' },
        { key: 'wastedQty', label: 'Wasted qty' },
      ]
      rows = wastageMock.data.byItem.map((i) => ({
        itemId: i.itemId,
        name: i.name,
        category: i.category,
        wastagePct: i.wastagePct,
        wastageCost: Math.round(i.wastageCost * scale),
        wastedQty: Math.round(i.wastedQty * scale),
      }))
      break
    }
    case 'outlet-comparison': {
      columns = [
        { key: 'id', label: 'Outlet ID' },
        { key: 'name', label: 'Outlet' },
        { key: 'city', label: 'City' },
        { key: 'revenue', label: 'Revenue (PKR)' },
        { key: 'orders', label: 'Orders' },
        { key: 'aov', label: 'AOV (PKR)' },
        { key: 'marginPct', label: 'Margin %' },
        { key: 'flags', label: 'Flags' },
      ]
      rows = locationsMock.data.outlets.map((o) => ({
        id: o.id,
        name: o.name,
        city: o.city,
        revenue: Math.round(o.revenue * scale),
        orders: Math.round(o.orders * scale),
        aov: o.aov,
        marginPct: o.profitMarginPct,
        flags: (o.flags ?? []).join('; '),
      }))
      break
    }
    case 'channel-economics': {
      columns = [
        { key: 'channel', label: 'Channel' },
        { key: 'revenue', label: 'Revenue (PKR)' },
        { key: 'orders', label: 'Orders' },
        { key: 'aov', label: 'AOV (PKR)' },
        { key: 'discountPct', label: 'Discount %' },
        { key: 'platformFeePct', label: 'Platform fee %' },
        { key: 'contributionMarginPct', label: 'Contribution %' },
      ]
      rows = channelsMock.data.channels.map((c) => ({
        channel: c.label,
        revenue: Math.round(c.revenue * scale),
        orders: Math.round(c.orders * scale),
        aov: c.aov,
        discountPct: c.discountPct,
        platformFeePct: c.platformFeePct,
        contributionMarginPct: c.contributionMarginPct,
      }))
      break
    }
    case 'anomaly-log': {
      columns = [
        { key: 'id', label: 'Anomaly ID' },
        { key: 'type', label: 'Type' },
        { key: 'severity', label: 'Severity' },
        { key: 'detectedAt', label: 'Detected at' },
        { key: 'summary', label: 'Summary' },
        { key: 'status', label: 'Status' },
      ]
      rows = anomaliesMock.data.anomalies.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        detectedAt: a.detectedAt,
        summary: a.summary,
        status: anomalyOverrides.get(a.id) ?? a.status,
      }))
      break
    }
    case 'customer-segments': {
      columns = [
        { key: 'segment', label: 'Segment' },
        { key: 'customers', label: 'Customers' },
        { key: 'revenue', label: 'Revenue (PKR)' },
        { key: 'avgOrderValue', label: 'AOV (PKR)' },
        { key: 'avgOrdersPerCustomer', label: 'Orders / customer' },
      ]
      rows = customersMock.data.segments.map((s) => ({
        segment: s.label,
        customers: Math.round(s.customers * scale),
        revenue: Math.round(s.revenue * scale),
        avgOrderValue: s.avgOrderValue,
        avgOrdersPerCustomer: s.avgOrdersPerCustomer,
      }))
      break
    }
    case 'rfm-tiers': {
      columns = [
        { key: 'tier', label: 'Tier' },
        { key: 'customers', label: 'Customers' },
        { key: 'revenue', label: 'Revenue (PKR)' },
        { key: 'avgRecencyDays', label: 'Avg recency (d)' },
        { key: 'avgFrequency', label: 'Avg frequency' },
        { key: 'avgMonetary', label: 'Avg monetary (PKR)' },
      ]
      rows = customersMock.data.rfmTiers.map((t) => ({
        tier: t.tier,
        customers: Math.round(t.customers * scale),
        revenue: Math.round(t.revenue * scale),
        avgRecencyDays: t.avgRecencyDays,
        avgFrequency: t.avgFrequency,
        avgMonetary: Math.round(t.avgMonetary),
      }))
      break
    }
    case 'churn-risk-list': {
      columns = [
        { key: 'id', label: 'Customer ID' },
        { key: 'segment', label: 'Segment' },
        { key: 'orders', label: 'Lifetime orders' },
        { key: 'lifetimeValue', label: 'Lifetime value (PKR)' },
        { key: 'lastOrderDaysAgo', label: 'Last order (days ago)' },
        { key: 'churnRisk', label: 'Churn risk' },
      ]
      const all = Array.from({ length: def.rows }, (_, i) => {
        const t = customersMock.data.topCustomers[i % customersMock.data.topCustomers.length]
        return {
          id: `CUST-${70000 - i * 13}`,
          segment: t.segment,
          orders: Math.max(2, Math.round(t.orders * seedNoise(`${id}-${i}-orders`, 0.5))),
          lifetimeValue: Math.round(t.lifetimeValue * seedNoise(`${id}-${i}-ltv`, 0.6)),
          lastOrderDaysAgo: Math.min(90, t.lastOrderDaysAgo + Math.round(i / 14)),
          churnRisk: i < Math.round(def.rows * 0.22) ? 'high' : i < Math.round(def.rows * 0.55) ? 'medium' : 'low',
        }
      })
      rows = all.slice(0, SAMPLE_CAP)
      truncated = true
      break
    }
    case 'pipeline-audit': {
      columns = [
        { key: 'id', label: 'Run ID' },
        { key: 'jobName', label: 'Job' },
        { key: 'pipeline', label: 'Pipeline' },
        { key: 'status', label: 'Status' },
        { key: 'durationSec', label: 'Duration (s)' },
        { key: 'rowsIn', label: 'Rows in' },
      ]
      rows = modelsMock.data.recentRuns.map((r) => ({
        id: r.id,
        jobName: r.jobName,
        pipeline: r.pipeline,
        status: r.status,
        durationSec: r.durationSec,
        rowsIn: r.rowsIn,
      }))
      truncated = rows.length < def.rows
      break
    }
    default:
      throw new ApiError(`Report '${id}' has no sample rows registered in mock mode.`, 422, 'no_data', '/api/reports')
  }

  void fmtPkr
  return {
    data: {
      reportId: id,
      columns,
      rows,
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      truncated: truncated || rows.length < def.rows,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      filters: filters as Record<string, unknown>,
      note: truncated || rows.length < def.rows
        ? `Mock sample: ${rows.length} of ${def.rows} production rows returned — marked truncated.`
        : `Sample export: ${rows.length} rows for the selected scope.`,
    },
  }
}

/** Admin overview (Phase 5) — platform operations payload, global scope. */
function handleAdmin(): AdminOverviewResponse {
  return { ...adminMock, meta: { ...adminMock.meta, generatedAt: new Date().toISOString() } }
}

/* ---------------------------------- auth ----------------------------------- */

function handleLogin(body: unknown): LoginResponse {
  const { email, password } = (body ?? {}) as { email?: string; password?: string }
  const account = demoAccounts.accounts.find((a) => a.email === (email ?? '').toLowerCase().trim())
  if (!account || account.password !== password) {
    authFailure('Incorrect email or password.')
  }
  return {
    token: `mock.${btoa(account.id)}`,
    user: {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role as LoginResponse['user']['role'],
      outletScope: account.outletScope,
    },
  }
}

function handleMe(): MeResponse {
  // The mock token format is `mock.<base64(userId)>`. getToken() reads the
  // same storage key the production client uses for the Bearer header.
  const headerToken = getToken()
  if (!headerToken?.startsWith('mock.')) authFailure('Session expired. Sign in again.')
  let userId = ''
  try {
    userId = atob(headerToken.slice(5))
  } catch {
    authFailure('Session expired. Sign in again.')
  }
  const account = demoAccounts.accounts.find((a) => a.id === userId)
  if (!account) authFailure('Session expired. Sign in again.')
  return {
    user: {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role as MeResponse['user']['role'],
      outletScope: account.outletScope,
    },
  }
}

/* --------------------------------- router ---------------------------------- */

export async function mockRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  body?: unknown,
): Promise<T> {
  await latency(endpoint)
  const path = endpoint.split('?')[0]
  const q = parseQuery(endpoint)

  if (path === '/api/auth/login' && method === 'POST') return handleLogin(body) as T
  if (path === '/api/auth/me' && method === 'GET') return handleMe() as T

  const filters: GlobalFilters = {
    dateFrom: q.get('dateFrom') ?? undefined,
    dateTo: q.get('dateTo') ?? undefined,
    location: q.get('location') ?? undefined,
    category: q.get('category') ?? undefined,
    channel: q.get('channel') ?? undefined,
  }

  switch (path) {
    case '/api/kpis':
      return handleKpis(filters) as T
    case '/api/menu/items':
      return handleMenuItems(filters) as T
    case '/api/menu/summary':
      return handleMenuSummary(filters) as T
    case '/api/locations/compare':
      return { ...locationsMock, meta: { ...locationsMock.meta, generatedAt: new Date().toISOString() } } as T
    case '/api/channels/compare':
      return { ...channelsMock, meta: { ...channelsMock.meta, generatedAt: new Date().toISOString() } } as T
    case '/api/recommendations':
      return handleRecommendations({
        ...filters,
        priority: q.get('priority') ?? undefined,
        status: q.get('status') ?? undefined,
      }) as T
    case '/api/anomalies':
      return handleAnomalies({
        ...filters,
        limit: q.get('limit') ? Number(q.get('limit')) : undefined,
      }) as T
    case '/api/customers/overview':
      return handleCustomers(filters) as T
    case '/api/basket/analysis':
      return handleBasket(filters) as T
    case '/api/forecast/overview':
      return handleForecast(filters) as T
    case '/api/wastage/overview':
      return handleWastage(filters) as T
    case '/api/pricing/overview':
      return handlePricing(filters) as T
    case '/api/locations/detail':
      return handleLocationsDetail(filters) as T
    case '/api/channels/hourly':
      return handleChannelsHourly(filters) as T
    case '/api/pipelines/compare':
      return handleModels() as T
    case '/api/reports/catalog':
      return handleReportsCatalog() as T
    case '/api/admin/overview':
      return handleAdmin() as T
    default:
      break
  }

  if (method === 'POST' && path === '/api/whatif/simulate') {
    return handleWhatIf(body, filters) as T
  }

  const statusMatch = path.match(/^\/api\/recommendations\/([^/]+)\/status$/)
  if (method === 'POST' && statusMatch) {
    return handleRecommendationStatus(decodeURIComponent(statusMatch[1]), body) as T
  }

  const anomalyStatusMatch = path.match(/^\/api\/anomalies\/([^/]+)\/status$/)
  if (method === 'POST' && anomalyStatusMatch) {
    return handleAnomalyStatus(decodeURIComponent(anomalyStatusMatch[1]), body) as T
  }

  const reportRunMatch = path.match(/^\/api\/reports\/([^/]+)\/run$/)
  if (method === 'POST' && reportRunMatch) {
    return handleReportRun(decodeURIComponent(reportRunMatch[1]), filters) as T
  }

  throw new ApiError(
    `This endpoint is not part of the mock surface: ${method} ${path}`,
    404,
    'not_found',
    endpoint,
  )
}
