/**
 * API contract types — DineIQ Analytics (spec §39/§40).
 *
 * These interfaces describe the FastAPI analytics backend contract. Mock data
 * (src/mocks/*.json) is cast to THE SAME types — there is no separate mock
 * schema. `any` is forbidden for API responses; extend types here instead.
 *
 * NOTE: The backend contract is authoritative. Where the real backend
 * deviates, adjust these types — never reshape backend data in components.
 */

/* ---------------------------------- Core ---------------------------------- */

export type Pipeline = 'spark' | 'python'

import type { Permission, UserRole } from '@/lib/permissions'

export interface EvidenceItem {
  metric: string
  value: string
  detail?: string
}

export interface Insight {
  /** 2–3 API-supplied sentences rendered verbatim by <InsightStrip />. */
  summary: string[]
  whyItMatters?: string
  evidence?: EvidenceItem[]
  affectedDimension?: string
  period?: string
  recommendedAction?: string
}

export interface ModelInfo {
  name: string
  version: string
  generatedAt: string
  pipeline: Pipeline
  confidence?: number
}

export interface ResponseMeta {
  generatedAt?: string
  pipeline?: Pipeline
  modelName?: string
  modelVersion?: string
  /** Echo of the filters applied by the backend when producing the payload. */
  filters?: Record<string, unknown>
  /** Mock-mode coverage note (e.g. available sample window). */
  note?: string
}

/** Envelope used by list/aggregate endpoints when they need meta + insight. */
export interface ApiResponse<T> {
  data: T
  meta?: ResponseMeta
  insight?: Insight
}

/* --------------------------------- Filters -------------------------------- */

export type PerformanceClass =
  | 'unclassified'
  | 'profit_driver'
  | 'volume_driver'
  | 'hidden_opportunity'
  | 'low_performer'

/**
 * Global filter state. Persisted to the URL (spec §14). Phase 1 exposes
 * date range + location + category + channel; the remaining keys are part of
 * the contract and activate as their modules ship in later phases.
 */
export interface GlobalFilters {
  dateFrom?: string
  dateTo?: string
  location?: string
  category?: string
  channel?: string
  segment?: string
  promotion?: string
  performanceClass?: PerformanceClass
  priceMin?: number
  priceMax?: number
  ratingMin?: number
  wastageMin?: number
  wastageMax?: number
}

/* ---------------------------------- Auth ---------------------------------- */

export type AuthErrorKind = 'invalid_credentials' | 'network'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  outletScope?: string[]
}

export interface LoginResponse {
  user: User
}

export interface MeResponse {
  user: User | null
}

/* ---------------------------------- KPIs ---------------------------------- */

export type KpiUnit = 'pkr' | 'count' | 'percent' | 'rating'
export type DeltaDirection = 'up' | 'down' | 'flat'
export type Favorability = 'positive' | 'negative' | 'neutral'

/**
 * A single KPI card. The API decides favorability (e.g. rising wastage is
 * negative) so the frontend never applies business semantics to raw deltas.
 */
export interface Kpi {
  id: string
  label: string
  unit: KpiUnit
  value: number
  deltaPct?: number
  deltaDirection?: DeltaDirection
  deltaFavorability?: Favorability
  comparisonLabel?: string
  sparkline?: number[]
  /** REST endpoint that produced this KPI — surfaced in the card tooltip. */
  source: string
  /** Present when the KPI is model-driven (e.g. forecast demand). */
  model?: ModelInfo
}

export interface TrendPoint {
  date: string
  revenue: number
  orders: number
}

export type TrendAnnotationType =
  | 'promotion'
  | 'anomaly'
  | 'peak'
  | 'price_change'
  | 'forecast_boundary'

export interface TrendAnnotation {
  date: string
  type: TrendAnnotationType
  label: string
  note?: string
}

export interface RevenueTrend {
  series: TrendPoint[]
  annotations: TrendAnnotation[]
}

export interface ChannelMixPoint {
  channel: string
  label: string
  revenue: number
  share: number
  orders: number
}

export interface HourWeekdayCell {
  weekday: string
  hour: number
  orders: number
}

export interface HourWeekdayMatrix {
  hours: number[]
  weekdays: string[]
  values: HourWeekdayCell[]
}

export interface DishRankItem {
  rank: number
  itemId: string
  name: string
  category: string
  revenue: number
  quantity: number
  marginPct: number
  rating?: number
  performanceClass: PerformanceClass
}

export interface TopBottomDishes {
  top: DishRankItem[]
  bottom: DishRankItem[]
}

export interface KpisData {
  /** Comparison period covered by the payload (e.g. "Aug 25 – Sep 23, 2026"). */
  periodLabel: string
  kpis: Kpi[]
  revenueTrend: RevenueTrend
  channelMix: ChannelMixPoint[]
  hourWeekday: HourWeekdayMatrix
  topBottomDishes: TopBottomDishes
}

export type KpisResponse = ApiResponse<KpisData>

/* ------------------------------- Menu items ------------------------------- */

/**
 * Menu item analytics row (spec §25). `revenue`/`quantity` cover the
 * filtered period; percentage fields are as supplied by the API.
 */
export interface MenuItem {
  itemId: string
  name: string
  category: string
  categoryId: string
  price: number
  revenue: number
  quantity: number
  marginPct: number
  costPct: number
  rating: number
  repeatRatePct: number
  wastagePct: number
  promoDependencyPct: number
  trendPct: number
  performanceClass: PerformanceClass
}

export type MenuItemsResponse = ApiResponse<{ items: MenuItem[] }>

/* -------------------------------- Locations ------------------------------- */

export interface OutletComparison {
  id: string
  name: string
  city: string
  revenue: number
  orders: number
  aov: number
  profitMarginPct: number
  rating: number
  performanceClass: PerformanceClass
  /** Share of national revenue — also used for mock filter scaling. */
  revenueShare: number
  flags?: string[]
}

export type LocationsResponse = ApiResponse<{ outlets: OutletComparison[] }>

/* --------------------------------- Channels ------------------------------- */

export interface ChannelComparison {
  channel: string
  label: string
  revenue: number
  orders: number
  basketSize: number
  aov: number
  discountPct: number
  peakHours: number[]
  platformFeePct: number
  contributionMarginPct: number
  /** Share of national revenue — used for mock filter scaling. */
  revenueShare: number
}

export type ChannelsResponse = ApiResponse<{ channels: ChannelComparison[] }>

/* ----------------------------- Recommendations ---------------------------- */

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low' | 'unranked'
export type RecommendationStatus = 'new' | 'acknowledged' | 'dismissed' | 'unavailable'

export interface Recommendation {
  id: string
  priority: RecommendationPriority
  type: string
  /** Action sentence supplied by the recommendation engine. */
  action: string
  itemId?: string
  outletId?: string
  categoryId?: string
  entityLabel?: string
  /** Estimated impact is OPTIONAL — cards omit it when the API omits it. */
  estimatedImpact?: {
    metric: string
    direction: 'increase' | 'decrease'
    estimate: string
  }
  /** MANDATORY: recommendations without evidence are not rendered. */
  evidence: EvidenceItem[]
  status: RecommendationStatus
  createdAt: string
}

export type RecommendationsResponse = ApiResponse<{ recommendations: Recommendation[] }>

/* -------------------------------- Anomalies ------------------------------- */

export type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low' | 'unranked'
export type AnomalyStatus = 'new' | 'reviewing' | 'resolved' | 'dismissed' | 'unavailable'

export interface Anomaly {
  id: string
  type: string
  severity: AnomalySeverity
  detectedAt: string
  dimension: string
  dimensionRef?: string
  summary: string
  detectionMethod?: string
  evidence: EvidenceItem[]
  status: AnomalyStatus
}

export type AnomaliesResponse = ApiResponse<{ anomalies: Anomaly[] }>

/* --------------------------- Menu summary (Phase 2) ------------------------ */

/**
 * Menu-level analytics payload for the Menu Intelligence page (spec §25).
 * All aggregates — including quadrant medians, class distribution and the
 * "tricky cases" watchlist — are computed by the backend from the same item
 * rows served by GET /api/menu/items. The frontend only visualizes them.
 */
export interface MenuKpis {
  itemsTracked: number
  /** Share of national revenue the tracked items cover (0–1). */
  revenueCoverage: number
  avgMarginPct: number
  avgRating: number
  /** Items where more than half of volume is promo-driven (API threshold). */
  promoDependentItems: number
  /** Revenue-weighted wastage percentage across tracked items. */
  wastagePct: number
}

/** One point of the popularity × margin scatter — mirrors a MenuItem row. */
export interface MenuScatterPoint {
  itemId: string
  name: string
  category: string
  categoryId: string
  /** Share of tracked quantity sold (0–1, API-supplied). */
  popularityShare: number
  marginPct: number
  revenue: number
  quantity: number
  rating: number
  trendPct: number
  performanceClass: PerformanceClass
  /** True when the item sits above BOTH quadrant medians (API-computed). */
  inQuadrantStar: boolean
}

export interface MenuScatter {
  points: MenuScatterPoint[]
  /** API-computed medians that draw the quadrant guide lines. */
  medianPopularityShare: number
  medianMarginPct: number
  /** API-supplied quadrant labels (rendered verbatim). */
  quadrantLabels: { high: string; low: string }
}

export interface MenuClassSlice {
  performanceClass: PerformanceClass
  count: number
  revenue: number
  /** Share of tracked revenue (0–1). */
  revenueShare: number
}

export type MenuCaseType =
  | 'promo_dependency'
  | 'high_wastage'
  | 'rating_risk'
  | 'fading_star'
  | 'margin_outlier'

/** A backend-flagged "tricky menu case" — headline + evidence, never narrated client-side. */
export interface MenuCase {
  id: string
  caseType: MenuCaseType
  severity: 'high' | 'medium' | 'low'
  itemId?: string
  itemName?: string
  headline: string
  detail: string
  evidence: EvidenceItem[]
}

export interface MenuSummaryData {
  periodLabel: string
  kpis: MenuKpis
  scatter: MenuScatter
  classDistribution: MenuClassSlice[]
  trickyCases: MenuCase[]
}

export type MenuSummaryResponse = ApiResponse<MenuSummaryData>

/* -------------------------- What-If Simulator (Phase 2) -------------------- */

/**
 * What-If simulation contract (spec §27). The backend owns the elasticity
 * and cost model; the response ALWAYS carries `estimate: true` plus model
 * metadata, and the UI must render the ESTIMATE disclaimer whenever a
 * result is displayed (integrity rule 5 — estimates are never actuals).
 */
export interface WhatIfScenarioInput {
  elasticity?: number
  itemId: string
  /** Signed price change, −20 … +20 (percent). */
  priceChangePct: number
  /** Discount applied on top of the (changed) price, 0 … 30 (percent). */
  discountPct: number
  /** Preparation / stock quantity change, −30 … +10 (percent). */
  prepChangePct: number
  /** Simulation horizon in days, 7 | 14 | 30. */
  horizonDays: 7 | 14 | 30
}

export interface WhatIfMetrics {
  price: number
  quantity: number
  revenue: number
  profit: number
  marginPct: number
}

export type WhatIfDeltaDirection = 'increase' | 'decrease' | 'flat'

export interface WhatIfDelta {
  metric: string
  baseline: number
  scenario: number
  deltaPct: number
  direction: WhatIfDeltaDirection
  /** API-decided favorability (e.g. rising wastage is negative). */
  favorability: 'positive' | 'negative' | 'neutral'
}

export interface WhatIfResult {
  estimate: true
  itemId: string
  itemName: string
  category: string
  /** Scope the baseline was computed for (echo of the global filters). */
  scopeLabel: string
  horizonDays: number
  baseline: WhatIfMetrics
  scenario: WhatIfMetrics
  deltas: WhatIfDelta[]
  /** Model assumptions, supplied verbatim by the backend. */
  assumptions: EvidenceItem[]
  notes: string[]
}

export type WhatIfResponse = ApiResponse<WhatIfResult>

/* ------------------- Recommendation status update (Phase 2) ----------------- */

export type RecommendationStatusResponse = ApiResponse<{ recommendation: Recommendation }>

/* ========================== PHASE 3 CONTRACTS ============================= */

/* --------------------------- Customers (Phase 3) --------------------------- */

export interface CustomerKpis {
  totalCustomers: number
  activeCustomers: number
  newCustomers: number
  repeatRatePct: number
  avgLifetimeValue: number
  avgOrdersPerCustomer: number
  /** Customers the churn model flags high-risk. */
  highChurnRisk: number
  /** Monthly revenue associated with high-risk customers. */
  revenueAtRisk: number
}

export interface CustomerSegment {
  id: string
  label: string
  customers: number
  revenue: number
  revenueShare: number
  avgOrderValue: number
  avgOrdersPerCustomer: number
  description: string
}

export interface RfmTier {
  tier: string
  customers: number
  revenue: number
  revenueShare: number
  avgRecencyDays: number
  avgFrequency: number
  avgMonetary: number
}

export interface ChurnRiskBucket {
  bucket: 'high' | 'medium' | 'low'
  label: string
  customers: number
  revenueAtRisk: number
  avgDaysSinceLastOrder: number
}

/** Monthly cohort retention row — retention[m] is the % still ordering. */
export interface CohortRow {
  cohort: string
  size: number
  retention: number[]
}

export interface TopCustomerRow {
  id: string
  segment: string
  orders: number
  lifetimeValue: number
  lastOrderDaysAgo: number
  churnRisk: 'high' | 'medium' | 'low' | 'inactive'
}

export interface PromoSensitivityRow {
  segment: string
  promoSharePct: number
  organicSharePct: number
  avgDiscountDepthPct: number
}

export interface CustomerOverviewData {
  periodLabel: string
  kpis: CustomerKpis
  segments: CustomerSegment[]
  rfmTiers: RfmTier[]
  churnRisk: ChurnRiskBucket[]
  cohortRetention: CohortRow[]
  topCustomers: TopCustomerRow[]
  promoSensitivity: PromoSensitivityRow[]
}

export type CustomerOverviewResponse = ApiResponse<CustomerOverviewData>

/* ------------------------- Basket analysis (Phase 3) ----------------------- */

export interface BasketKpis {
  basketsAnalyzed: number
  avgBasketSize: number
  avgBasketValue: number
  attachRatePct: number
  /** Rules with lift ≥ 1.5 and support ≥ 2% (backend thresholds). */
  strongRules: number
  bundleOpportunities: number
}

export type RuleOpportunity = 'bundle_candidate' | 'cross_sell' | 'menu_placement' | 'none'

export interface AssociationRule {
  id: string
  antecedent: { itemId: string; name: string }
  consequent: { itemId: string; name: string }
  category: string
  supportPct: number
  confidencePct: number
  lift: number
  pairOrders: number
  opportunity: RuleOpportunity
  estimatedImpact?: { metric: string; estimate: string }
}

export interface CategoryPairRow {
  categoryA: string
  categoryB: string
  pairOrders: number
  lift: number
}

export interface BasketSizeSlice {
  /** Number of lines in the basket. */
  size: number
  baskets: number
  sharePct: number
}

export interface BundleSuggestion {
  id: string
  items: { itemId: string; name: string; price: number }[]
  combinedPrice: number
  suggestedPrice: number
  /** Backend rationale, rendered verbatim. */
  basis: string
}

export interface BasketAnalysisData {
  periodLabel: string
  kpis: BasketKpis
  rules: AssociationRule[]
  categoryPairs: CategoryPairRow[]
  basketSizeDist: BasketSizeSlice[]
  bundles: BundleSuggestion[]
}

export type BasketAnalysisResponse = ApiResponse<BasketAnalysisData>

/* ------------------------ Demand forecast (Phase 3) ------------------------ */

export interface ForecastKpis {
  horizonDays: number
  forecastOrders: number
  forecastRevenue: number
  /** Mean absolute percentage error of the backtest. */
  mapePct: number
  /** Signed bias: positive = the model over-forecasts. */
  biasPct: number
  confidence: number
}

export interface ForecastDay {
  date: string
  /** Present on historical days only. */
  actual?: number
  forecast: number
  lower: number
  upper: number
  isForecast: boolean
}

export interface ForecastAccuracyRow {
  mae?: number
  r2?: number
  modelName: string
  pipeline: Pipeline
  mapePct: number
  rmse: number
  withinTolerancePct: number
  horizonTestedDays: number
}

export interface ForecastItemRow {
  itemId: string
  name: string
  category: string
  /** Trailing 7-day actual quantity. */
  actualQty: number
  /** Next 7-day forecast quantity. */
  forecastQty: number
  deltaPct: number
  confidence: number
  trend: 'rising' | 'stable' | 'falling'
}

export interface ForecastOverviewData {
  periodLabel: string
  kpis: ForecastKpis
  daily: ForecastDay[]
  accuracy: ForecastAccuracyRow[]
  items: ForecastItemRow[]
}

export type ForecastOverviewResponse = ApiResponse<ForecastOverviewData>

/* --------------------------- Wastage (Phase 3) ----------------------------- */

export interface WastageKpis {
  wastageCost: number
  wastagePctOfRevenue: number
  deltaPct: number
  /** Share of wastage caused by over-preparation. */
  prepWasteSharePct: number
  /** Share of wastage caused by spoilage/expiry. */
  spoilageSharePct: number
  worstCategory: string
  worstOutlet: string
}

export interface WastageTrendPoint {
  date: string
  wastageCost: number
  wastagePct: number
}

export interface WastageCategoryRow {
  categoryId: string
  category: string
  wastageCost: number
  wastagePct: number
  shareOfWastage: number
  topItem: string
}

export interface WastageItemRow {
  itemId: string
  name: string
  category: string
  wastagePct: number
  wastageCost: number
  preparedQty: number
  wastedQty: number
}

export interface WastageOutletRow {
  outletId: string
  outlet: string
  city: string
  wastageCost: number
  wastagePct: number
  flag?: string
}

export interface WastageOverviewData {
  periodLabel: string
  kpis: WastageKpis
  trend: WastageTrendPoint[]
  byCategory: WastageCategoryRow[]
  byItem: WastageItemRow[]
  byOutlet: WastageOutletRow[]
}

export type WastageOverviewResponse = ApiResponse<WastageOverviewData>

/* ========================== PHASE 4 CONTRACTS ============================= */

/* --------------------- Pricing & Promotions (Phase 4) ---------------------- */

export type PriceRecommendation = 'raise' | 'test' | 'hold' | 'reduce' | 'unavailable'

export interface ElasticityRow {
  rowId?: string
  itemId: string
  name: string
  category: string
  currentPrice: number
  /** Signed elasticity from the pricing model (−2 … 0). */
  elasticity: number
  marginPct: number
  trendPct: number
  recommendation: PriceRecommendation
  /** Model rationale, rendered verbatim. */
  rationale: string
  confidence: number
}

export interface PricingKpis {
  itemsAnalyzed: number
  avgElasticity: number
  inelasticItems: number
  elasticItems: number
  testCandidates: number
  revenueAtStake: number
}

export interface PromoCampaign {
  id: string
  name: string
  channel: string
  window: string
  discountPct: number
  orders: number
  revenue: number
  incrementalRevenue: number
  /** Incremental revenue / discount cost. */
  roi: number
  marginImpactPct: number
  status: 'active' | 'completed' | 'historical'
  verdict: 'scale' | 'optimize' | 'retire' | 'unavailable'
}

export interface PromoKpis {
  activeCampaigns: number
  revenueOnPromoPct: number
  avgDiscountPct: number
  positiveRoiCampaigns: number
  trappedItems: number
}

export interface PromoTrap {
  itemId: string
  name: string
  promoDependencyPct: number
  /** Profit change per order on promo days vs regular days. */
  profitOnPromoDaysPct: number
  evidence: EvidenceItem[]
}

export interface PricingPromoData {
  periodLabel: string
  pricingKpis: PricingKpis
  elasticity: ElasticityRow[]
  promoKpis: PromoKpis
  campaigns: PromoCampaign[]
  promoTraps: PromoTrap[]
}

export type PricingPromoResponse = ApiResponse<PricingPromoData>

/* ---------------------- Locations detail (Phase 4) ------------------------- */

export interface CityAggregate {
  city: string
  outlets: number
  revenue: number
  revenueShare: number
  avgMarginPct: number
  bestOutlet: string
  worstOutlet: string
}

export interface LocationsDetailData {
  periodLabel: string
  kpis: {
    outlets: number
    cities: number
    bestOutlet: string
    flaggedOutlets: number
    avgMarginPct: number
  }
  cityAggregates: CityAggregate[]
  matrix: {
    outletIds: string[]
    outletNames: string[]
    categories: string[]
    values: { outletId: string; categoryId: string; revenue: number }[]
  }
}

export type LocationsDetailResponse = ApiResponse<LocationsDetailData>

/* ---------------------- Channels hourly (Phase 4) -------------------------- */

export interface ChannelsHourlyData {
  channels: { channel: string; label: string }[]
  hours: number[]
  values: { channel: string; hour: number; orders: number }[]
}

export type ChannelsHourlyResponse = ApiResponse<ChannelsHourlyData>

/* ---------------------------- Anomalies (Phase 4) --------------------------- */

export type AnomalyStatusResponse = ApiResponse<{ anomaly: Anomaly }>

/* ========================== PHASE 5 CONTRACTS ============================= */

/* --------------------- Pipeline comparison (Phase 5) ----------------------- */

export interface PipelineMetric {
  metric: string
  unit: string
  sparkValue: number
  pythonValue: number
  better: 'spark' | 'python' | 'tie'
  note?: string
}

export interface AgreementRow {
  metric: string
  agreementPct: number
  sampleSize: number
  maxDeviationPct: number
}

export interface PipelineRun {
  id: string
  jobName: string
  pipeline: Pipeline
  startedAt: string
  durationSec: number
  rowsIn: number
  rowsOut: number
  status: 'success' | 'failed' | 'running' | 'unknown'
}

export interface RecordDiffRow {
  recordId: string
  field: string
  sparkValue: string
  pythonValue: string
  match: boolean
}

export interface ModelComparisonData {
  kpis: {
    agreementPct: number
    sparkJobs: number
    pythonJobs: number
    recordsCompared: number
    lastComparedAt: string
  }
  metrics: PipelineMetric[]
  agreement: AgreementRow[]
  recentRuns: PipelineRun[]
  recordDiffSample: RecordDiffRow[]
}

export type ModelComparisonResponse = ApiResponse<ModelComparisonData>

/* -------------------------- Reports (Phase 5) ------------------------------ */

export interface ReportDef {
  id: string
  name: string
  description: string
  format: 'csv' | 'xlsx'
  /** Row count the backend reported for the last full export. */
  rows: number
  lastGenerated: string
  requiresPermission: Permission
  scopeNote: string
}

export type ReportCatalogResponse = ApiResponse<{ reports: ReportDef[] }>

/**
 * POST /api/reports/{id}/run returns a REAL sample of export rows (the same
 * shape the backend streams). The frontend serializes to CSV for download —
 * it never invents rows. `truncated` marks a capped sample.
 */
export interface ReportRunResponse {
  data: {
    reportId: string
    columns: { key: string; label: string }[]
    rows: Record<string, string | number>[]
    generatedAt: string
    rowCount: number
    truncated: boolean
  }
  meta?: ResponseMeta
}

/* ---------------------------- Admin (Phase 5) ------------------------------- */

export interface SparkJobRow {
  id: string
  name: string
  status: 'success' | 'running' | 'failed' | 'unknown'
  startedAt: string
  durationSec: number
  stages: string
  cores: number
  rowsShuffled: number
}

export interface DataQualityCheck {
  id: string
  table: string
  check: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  lastRun: string
}

export interface ModelRegistryEntry {
  name: string
  version: string
  pipeline: Pipeline
  trainedAt: string
  status: 'production' | 'staging' | 'archived' | 'evidence'
  metrics: { name: string; value: string }[]
}

export interface AuditEvent {
  id: string
  user: string
  role: UserRole
  action: string
  target: string
  at: string
}

export interface AdminOverviewData {
  kpis: {
    tablesIngested: number
    rowsIngested: number
    runsLast24h: number
    failedJobs: number
    storageGb: number
    openQualityFails: number
  }
  sparkJobs: SparkJobRow[]
  dataQuality: DataQualityCheck[]
  modelRegistry: ModelRegistryEntry[]
  auditTrail: AuditEvent[]
}

export type AdminOverviewResponse = ApiResponse<AdminOverviewData>
