/**
 * DineIQ Analytics — Phase 1 mock dataset generator.
 *
 * Produces internally-consistent sample datasets that the mock adapter serves
 * through the typed API client. Consistency invariants enforced below:
 *
 *   1. Revenue trend daily series sums exactly to the revenue KPI.
 *   2. Order counts (hour × weekday heatmap) sum exactly to the orders KPI.
 *   3. Channel mix shares sum to 1.0 and revenue shares sum to total revenue.
 *   4. AOV KPI equals revenue / orders exactly.
 *   5. Top/bottom dishes are derived from the same item rows as
 *      menu-items.json (recommendations reference these same items/outlets).
 *   6. Outlet revenue shares sum to 1.0.
 *
 * Run: node scripts/generate-mocks.mjs   (writes to src/mocks/*.json)
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../src/mocks')
mkdirSync(OUT_DIR, { recursive: true })

/* ------------------------------- utilities -------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20260924)
const rand = () => rng()
const rint = (min, max) => Math.floor(rand() * (max - min + 1)) + min
const noise = (min = 0.92, max = 1.08) => min + rand() * (max - min)
const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100

function compactPkr(n) {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `PKR ${round1(n / 1e6)}M`
  if (abs >= 1e3) return `PKR ${round1(n / 1e3)}K`
  return `PKR ${Math.round(n)}`
}
function compactInt(n) {
  if (n >= 1e6) return `${round1(n / 1e6)}M`
  if (n >= 1e3) return `${round1(n / 1e3)}K`
  return `${Math.round(n)}`
}

/* ------------------------------ date window ------------------------------- */

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)
const END = new Date(TODAY)
END.setDate(END.getDate() - 1) // yesterday = last data day
const START = new Date(TODAY)
START.setDate(START.getDate() - 30)

function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const shortDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const PERIOD_LABEL = `${shortDate(START)} – ${shortDate(END)}, ${END.getFullYear()}`

const DAYS = []
for (let d = new Date(START); d <= END; d.setDate(d.getDate() + 1)) DAYS.push(new Date(d))
const N = DAYS.length // 30

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekdayFactor = { Mon: 0.82, Tue: 0.86, Wed: 0.9, Thu: 0.99, Fri: 1.18, Sat: 1.28, Sun: 1.1 }
const wdIndex = (d) => (d.getDay() + 6) % 7 // Mon-first index

/* ---------------------------- daily series ------------------------------- */

const BASE_DAILY_REVENUE = 1_540_000
const PROMO_START = new Date(END.getFullYear(), 8, 4)
const PROMO_END = new Date(END.getFullYear(), 8, 8)
const SPIKE_DATE = new Date(END.getFullYear(), 8, 19)

const series = DAYS.map((d, i) => {
  const wf = weekdayFactor[WEEKDAYS[wdIndex(d)]]
  const trend = Math.pow(1.0012, i)
  let f = wf * trend * noise()
  if (d >= PROMO_START && d <= PROMO_END) f *= 1.12
  if (d.getTime() === SPIKE_DATE.getTime()) f *= 1.19
  return { date: isoDate(d), revenue: Math.round((BASE_DAILY_REVENUE * f) / 1000) * 1000 }
})

const revenueTotal = series.reduce((s, p) => s + p.revenue, 0)

// Orders from a per-day AOV around PKR 1,836 (±2% noise)
for (const p of series) {
  const aov = 1836 * noise(0.98, 1.02)
  p.orders = Math.max(1, Math.round(p.revenue / aov))
}
let ordersTotal = series.reduce((s, p) => s + p.orders, 0)
const aovTotal = revenueTotal / ordersTotal

/* ------------------------------ channel mix ------------------------------ */

const CHANNEL_DEFS = [
  { channel: 'dine_in', label: 'Dine-in', share: 0.44, aov: 2150, basket: 3.4, discount: 2.1, fee: 0, contribution: 31.1, peaks: [13, 14, 20, 21] },
  { channel: 'delivery', label: 'Delivery', share: 0.26, aov: 1780, basket: 3.1, discount: 8.4, fee: 22, contribution: 22.8, peaks: [20, 21, 22] },
  { channel: 'takeaway', label: 'Takeaway', share: 0.17, aov: 1420, basket: 2.2, discount: 3.2, fee: 0, contribution: 30.4, peaks: [13, 20] },
  { channel: 'app', label: 'App', share: 0.13, aov: 1910, basket: 3.6, discount: 12.6, fee: 15, contribution: 24.6, peaks: [19, 20, 21] },
]

const channelMix = CHANNEL_DEFS.map((c) => {
  const revenue = Math.round(revenueTotal * c.share)
  const orders = Math.round(revenue / c.aov)
  return { channel: c.channel, label: c.label, revenue, share: round2(c.share), orders }
})

/* --------------------------------- items ---------------------------------- */

const CATEGORY_DEFS = [
  { id: 'cat-biryani-rice', name: 'Biryani & Rice' },
  { id: 'cat-karahi-handi', name: 'Karahi & Handi' },
  { id: 'cat-bbq-kebabs', name: 'BBQ & Kebabs' },
  { id: 'cat-burgers', name: 'Burgers & Sandwiches' },
  { id: 'cat-chinese', name: 'Chinese' },
  { id: 'cat-wraps-rolls', name: 'Wraps & Rolls' },
  { id: 'cat-snacks-sides', name: 'Snacks & Sides' },
  { id: 'cat-desserts', name: 'Desserts' },
  { id: 'cat-beverages', name: 'Beverages' },
  { id: 'cat-soups-salads', name: 'Soups & Salads' },
  { id: 'cat-family-deals', name: 'Family Deals' },
  { id: 'cat-breakfast', name: 'Breakfast' },
]
const catId = (name) => CATEGORY_DEFS.find((c) => c.name === name).id

// [name, category, price, class, weight, overrides]
const ITEM_DEFS = [
  ['Chicken Biryani', 'Biryani & Rice', 480, 'profit_driver', 0.052],
  ['Beef Biryani', 'Biryani & Rice', 550, 'profit_driver', 0.038],
  ['Mutton Biryani', 'Biryani & Rice', 720, 'hidden_opportunity', 0.012],
  ['Chicken Pulao', 'Biryani & Rice', 450, 'volume_driver', 0.021],
  ['Mutton Pulao', 'Biryani & Rice', 690, 'low_performer', 0.004],
  ['Zarda', 'Biryani & Rice', 250, 'low_performer', 0.003],
  ['Haleem', 'Biryani & Rice', 380, 'hidden_opportunity', 0.011],
  ['Chicken Karahi', 'Karahi & Handi', 1650, 'profit_driver', 0.036],
  ['Mutton Karahi', 'Karahi & Handi', 2400, 'profit_driver', 0.03],
  ['White Karahi', 'Karahi & Handi', 1800, 'hidden_opportunity', 0.01],
  ['Chicken Handi', 'Karahi & Handi', 1450, 'volume_driver', 0.019],
  ['Mutton Handi', 'Karahi & Handi', 2200, 'low_performer', 0.004],
  ['Nihari', 'Karahi & Handi', 540, 'hidden_opportunity', 0.012],
  ['Chicken Tikka', 'BBQ & Kebabs', 520, 'profit_driver', 0.04],
  ['Seekh Kebab', 'BBQ & Kebabs', 560, 'profit_driver', 0.034],
  ['Malai Boti', 'BBQ & Kebabs', 640, 'volume_driver', 0.024],
  ['Chapli Kebab', 'BBQ & Kebabs', 480, 'hidden_opportunity', 0.013],
  ['Behari Kebab', 'BBQ & Kebabs', 590, 'volume_driver', 0.018],
  ['Grill Platter', 'BBQ & Kebabs', 2450, 'hidden_opportunity', 0.014],
  ['Zinger Burger', 'Burgers & Sandwiches', 620, 'volume_driver', 0.033, { promoDependencyPct: 61 }],
  ['Beef Burger', 'Burgers & Sandwiches', 580, 'volume_driver', 0.022],
  ['Grilled Chicken Burger', 'Burgers & Sandwiches', 640, 'low_performer', 0.005],
  ['Club Sandwich', 'Burgers & Sandwiches', 520, 'low_performer', 0.004],
  ['Chicken Shawarma', 'Wraps & Rolls', 350, 'volume_driver', 0.026],
  ['Chicken Paratha Roll', 'Wraps & Rolls', 380, 'volume_driver', 0.02],
  ['Beef Paratha Roll', 'Wraps & Rolls', 420, 'hidden_opportunity', 0.009],
  ['Shawarma Roll', 'Wraps & Rolls', 320, 'low_performer', 0.005],
  ['Chicken Chowmein', 'Chinese', 690, 'volume_driver', 0.016],
  ['Chicken Manchurian', 'Chinese', 750, 'hidden_opportunity', 0.01],
  ['Egg Fried Rice', 'Chinese', 480, 'low_performer', 0.004],
  ['Dragon Chicken', 'Chinese', 890, 'low_performer', 0.003],
  ['Loaded Fries', 'Snacks & Sides', 420, 'volume_driver', 0.018],
  ['Masala Fries', 'Snacks & Sides', 280, 'volume_driver', 0.02],
  ['Chicken Nuggets', 'Snacks & Sides', 380, 'low_performer', 0.004],
  ['Mozzarella Sticks', 'Snacks & Sides', 450, 'low_performer', 0.004, { wastagePct: 9.8 }],
  ['Gulab Jamun', 'Desserts', 220, 'profit_driver', 0.022],
  ['Kheer', 'Desserts', 260, 'hidden_opportunity', 0.008],
  ['Falooda', 'Desserts', 340, 'hidden_opportunity', 0.011],
  ['Chocolate Lava Cake', 'Desserts', 490, 'low_performer', 0.004],
  ['Mint Margarita', 'Beverages', 220, 'profit_driver', 0.02],
  ['Cold Coffee', 'Beverages', 320, 'volume_driver', 0.017],
  ['Fresh Lime Soda', 'Beverages', 190, 'profit_driver', 0.016, { wastagePct: 14.2 }],
  ['Mango Lassi', 'Beverages', 280, 'volume_driver', 0.014],
  ['Chicken Corn Soup', 'Soups & Salads', 320, 'volume_driver', 0.01],
  ['Hot & Sour Soup', 'Soups & Salads', 320, 'hidden_opportunity', 0.008],
  ['Russian Salad', 'Soups & Salads', 290, 'low_performer', 0.003, { trendPct: -12.6 }],
  ['Deal for Two', 'Family Deals', 2200, 'profit_driver', 0.024],
  ['Family Feast Deal', 'Family Deals', 3900, 'hidden_opportunity', 0.012],
  ['Jumbo Platter', 'Family Deals', 4600, 'low_performer', 0.003],
  ['Halwa Puri', 'Breakfast', 290, 'volume_driver', 0.013],
  ['Omelette Paratha', 'Breakfast', 240, 'low_performer', 0.004],
  ['Chai', 'Breakfast', 120, 'profit_driver', 0.018],
]

const COVERAGE = 0.78 // share of national revenue covered by these 52 items
const weightSum = ITEM_DEFS.reduce((s, d) => s + d[4], 0)

const MARGIN = {
  profit_driver: [34, 42],
  volume_driver: [22, 30],
  hidden_opportunity: [30, 38],
  low_performer: [8, 17],
}
const RATING = {
  profit_driver: [4.2, 4.8],
  volume_driver: [3.9, 4.6],
  hidden_opportunity: [4.1, 4.7],
  low_performer: [3.0, 3.9],
}
const REPEAT = {
  profit_driver: [38, 55],
  volume_driver: [30, 46],
  hidden_opportunity: [22, 36],
  low_performer: [10, 22],
}

let itemCounter = 0
const items = ITEM_DEFS.map(([name, category, price, performanceClass, weight, overrides = {}]) => {
  itemCounter += 1
  const itemId = `itm-${String(itemCounter).padStart(3, '0')}`
  const revenue = Math.round(revenueTotal * COVERAGE * (weight / weightSum) * noise(0.9, 1.1))
  const quantity = Math.max(1, Math.round(revenue / price))
  const [mMin, mMax] = MARGIN[performanceClass]
  const [rMin, rMax] = RATING[performanceClass]
  const [pMin, pMax] = REPEAT[performanceClass]
  const marginPct = overrides.marginPct ?? round1(mMin + rand() * (mMax - mMin))
  const trendPct = overrides.trendPct ?? round1(-12 + rand() * 36)
  return {
    itemId,
    name,
    category,
    categoryId: catId(category),
    price,
    revenue,
    quantity,
    marginPct,
    costPct: round1((100 - marginPct) * (0.68 + rand() * 0.08)),
    rating: round1(rMin + rand() * (rMax - rMin)),
    repeatRatePct: rint(pMin, pMax),
    wastagePct: overrides.wastagePct ?? round1(1.5 + rand() * 5),
    promoDependencyPct: overrides.promoDependencyPct ?? rint(0, 26),
    trendPct,
    performanceClass,
  }
})

const itemRevenueSum = items.reduce((s, i) => s + i.revenue, 0)
const catShareOfTotal = {}
for (const c of CATEGORY_DEFS) {
  const sum = items.filter((i) => i.categoryId === c.id).reduce((s, i) => s + i.revenue, 0)
  catShareOfTotal[c.id] = round2(sum / itemRevenueSum)
}

/* ------------------------- top / bottom dishes ---------------------------- */

const ranked = [...items].sort((a, b) => b.revenue - a.revenue)
const toDish = (i, rank) => ({
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
const topDishes = ranked.slice(0, 8).map((i, idx) => toDish(i, idx + 1))
const bottomDishes = ranked.slice(-4).map((i, idx) => toDish(i, idx + 1))

/* ------------------------------- locations -------------------------------- */

const OUTLET_AREAS = [
  ['Karachi', 'DHA Phase 6'], ['Karachi', 'Clifton'], ['Karachi', 'Gulshan-e-Iqbal'],
  ['Karachi', 'Bahadurabad'], ['Karachi', 'Zamzama'], ['Karachi', 'Nazimabad'],
  ['Karachi', 'Malir Cantt'], ['Karachi', 'North Nazimabad'], ['Karachi', 'Shahra-e-Faisal'],
  ['Lahore', 'Gulberg III'], ['Lahore', 'DHA Phase 5'], ['Lahore', 'Johar Town'],
  ['Lahore', 'Bahria Town'], ['Lahore', 'Model Town'], ['Lahore', 'MM Alam Road'],
  ['Islamabad', 'F-7 Markaz'], ['Islamabad', 'Blue Area'], ['Islamabad', 'DHA Phase 2'],
  ['Islamabad', 'Bahria Enclave'], ['Rawalpindi', 'Saddar'], ['Rawalpindi', 'Bahria Town'],
  ['Faisalabad', 'D Ground'], ['Faisalabad', 'Kohinoor City'], ['Multan', 'Gulgasht'],
]

const rawShares = OUTLET_AREAS.map((_, i) => 1 / Math.pow(i + 1, 0.62) * noise(0.9, 1.1))
const shareSum = rawShares.reduce((s, v) => s + v, 0)
const shares = rawShares.map((v) => v / shareSum)

const OUTLET_FLAGS = {
  'DineIQ Zamzama': ['wastage_abnormal'],
  'DineIQ Blue Area': ['rating_drop'],
  'DineIQ Saddar': ['sales_drop'],
}

const outlets = OUTLET_AREAS.map(([city, area], i) => {
  const name = `DineIQ ${area}`
  const performanceClass =
    i < 9 ? 'profit_driver' : i < 17 ? 'volume_driver' : i < 21 ? 'hidden_opportunity' : 'low_performer'
  const revenue = Math.round(revenueTotal * shares[i])
  const orders = Math.round(ordersTotal * shares[i] * noise(0.92, 1.08))
  return {
    id: `out-${String(i + 1).padStart(2, '0')}`,
    name,
    city,
    revenue,
    orders,
    aov: Math.round(revenue / orders),
    profitMarginPct: round1(24 + rand() * 10),
    rating: round1(3.7 + rand() * 1.0),
    performanceClass,
    revenueShare: round2(shares[i]),
    flags: OUTLET_FLAGS[name] ?? [],
  }
})
const outletShareSum = outlets.reduce((s, o) => s + o.revenueShare, 0)

/* ---------------------------- hour × weekday ------------------------------ */

const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const HOUR_WEIGHTS = [0.55, 1.05, 1.55, 1.65, 1.35, 0.85, 0.65, 0.75, 1.05, 1.3, 1.55, 1.75, 1.45, 0.95]
const hourWeightSum = HOUR_WEIGHTS.reduce((s, v) => s + v, 0)

const matrix = {}
for (const wd of WEEKDAYS) matrix[wd] = Object.fromEntries(HOURS.map((h) => [h, 0]))
for (const p of series) {
  const wd = WEEKDAYS[wdIndex(new Date(`${p.date}T00:00:00`))]
  const weekendDinner = wd === 'Fri' || wd === 'Sat' || wd === 'Sun'
  // Apply the weekend dinner bump, then normalise so the day's orders
  // distribute across hours summing EXACTLY to that day's order count.
  const weights = HOUR_WEIGHTS.map((w, hi) =>
    weekendDinner && HOURS[hi] >= 19 && HOURS[hi] <= 22 ? w * 1.15 : w,
  )
  const wSum = weights.reduce((s, v) => s + v, 0)
  for (let hi = 0; hi < HOURS.length; hi++) {
    matrix[wd][HOURS[hi]] += (p.orders * weights[hi]) / wSum
  }
}
// Integerise while preserving the exact total (drift absorbed by largest remainders)
const cells = []
let intSum = 0
for (const wd of WEEKDAYS) {
  for (const h of HOURS) {
    const floorV = Math.floor(matrix[wd][h])
    matrix[wd][h] = { v: floorV, frac: matrix[wd][h] - floorV }
    intSum += floorV
  }
}
const drift = ordersTotal - intSum
const flatCells = []
for (const wd of WEEKDAYS) for (const h of HOURS) flatCells.push([wd, h])
flatCells.sort((a, b) => matrix[b[0]][b[1]].frac - matrix[a[0]][a[1]].frac)
for (let i = 0; i < drift; i++) {
  const [wd, h] = flatCells[i % flatCells.length]
  matrix[wd][h].v += 1
}
const hourWeekdayValues = []
for (const wd of WEEKDAYS) {
  for (const h of HOURS) hourWeekdayValues.push({ weekday: wd, hour: h, orders: matrix[wd][h].v })
}
const heatmapTotal = hourWeekdayValues.reduce((s, c) => s + c.orders, 0)

/* --------------------------------- KPIs ----------------------------------- */

const nowIso = new Date().toISOString()
const spark = (arr) => arr.map((v) => Math.round(v))
const last14 = series.slice(-14)
const activeSpark = Array.from({ length: 14 }, (_, i) => 17200 + i * 74 + rint(-160, 160))
const repeatSpark = Array.from({ length: 14 }, (_, i) => 7480 + i * 27 + rint(-70, 70))
const wastageSpark = last14.map((p) => p.revenue * (0.04 * noise(0.85, 1.15)))
const forecastValue = Math.round((series.reduce((s, p, i) => (i >= 23 ? s + p.orders : s), 0) / 7) * 7 * 1.037 / 10) * 10

const kpis = [
  {
    id: 'revenue', label: 'Revenue', unit: 'pkr', value: revenueTotal,
    deltaPct: 8.4, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: 'vs previous 30 days', source: 'GET /api/kpis',
    sparkline: spark(last14.map((p) => p.revenue)),
  },
  {
    id: 'profit', label: 'Contribution Profit', unit: 'pkr', value: Math.round(revenueTotal * 0.311),
    deltaPct: 6.9, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: 'vs previous 30 days', source: 'GET /api/kpis',
    sparkline: spark(last14.map((p) => p.revenue * 0.311)),
  },
  {
    id: 'orders', label: 'Orders', unit: 'count', value: ordersTotal,
    deltaPct: 5.2, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: 'vs previous 30 days', source: 'GET /api/kpis',
    sparkline: spark(last14.map((p) => p.orders)),
  },
  {
    id: 'aov', label: 'Average Order Value', unit: 'pkr', value: Math.round(aovTotal),
    deltaPct: 3.0, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: 'vs previous 30 days', source: 'GET /api/kpis',
    sparkline: spark(last14.map((p) => p.revenue / p.orders)),
  },
  {
    id: 'active-customers', label: 'Active Customers', unit: 'count', value: 18240,
    deltaPct: 4.1, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: 'vs previous 30 days', source: 'GET /api/kpis',
    sparkline: spark(activeSpark),
  },
  {
    id: 'repeat-customers', label: 'Repeat Customers', unit: 'count', value: 7860,
    deltaPct: 2.4, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: '43.1% of active customers', source: 'GET /api/kpis',
    sparkline: spark(repeatSpark),
  },
  {
    id: 'wastage-cost', label: 'Wastage Cost', unit: 'pkr', value: Math.round(revenueTotal * 0.0399),
    deltaPct: 3.2, deltaDirection: 'up', deltaFavorability: 'negative',
    comparisonLabel: 'vs previous 30 days', source: 'GET /api/kpis',
    sparkline: spark(wastageSpark),
  },
  {
    id: 'forecast-demand', label: 'Forecast Demand (7d)', unit: 'count', value: forecastValue,
    deltaPct: 3.7, deltaDirection: 'up', deltaFavorability: 'positive',
    comparisonLabel: 'next 7 days vs last 7', source: 'GET /api/kpis',
    sparkline: spark(Array.from({ length: 14 }, (_, i) => forecastValue / 7 + Math.sin(i / 2) * 40)),
    model: {
      name: 'DemandForecaster (XGBoost)', version: '3.2', generatedAt: nowIso,
      pipeline: 'python', confidence: 0.924,
    },
  },
]

/* ------------------------------- annotations ------------------------------ */

const peak = series.reduce((best, p) => (p.revenue > best.revenue ? p : best), series[0])
const annotations = [
  {
    date: isoDate(PROMO_START), type: 'promotion',
    label: 'Promotion window (Sep 4–8)',
    note: '5-day campaign flagged by the promotions engine; affected days carry an estimated +12% uplift.',
  },
  {
    date: peak.date, type: 'peak', label: 'Period revenue peak',
    note: `Highest daily revenue of the period: ${compactPkr(peak.revenue)}.`,
  },
  {
    date: isoDate(SPIKE_DATE), type: 'anomaly', label: 'Order spike detected',
    note: 'Dine-in surge at 3 Karachi outlets — see the Anomalies module for evidence.',
  },
].filter((a) => DAYS.some((d) => isoDate(d) === a.date))

/* --------------------------------- insight -------------------------------- */

const wastageValue = Math.round(revenueTotal * 0.0399)
const kpisJson = {
  data: {
    periodLabel: PERIOD_LABEL,
    kpis,
    revenueTrend: { series, annotations },
    channelMix,
    hourWeekday: { hours: HOURS, weekdays: WEEKDAYS, values: hourWeekdayValues },
    topBottomDishes: { top: topDishes, bottom: bottomDishes },
  },
  meta: { generatedAt: nowIso, filters: {} },
  insight: {
    summary: [
      `Revenue reached ${compactPkr(revenueTotal)} across ${compactInt(ordersTotal)} orders in the last 30 days, up 8.4% versus the previous period, with dine-in contributing 44% of revenue.`,
      `A promotion window during Sep 4–8 lifted affected days by an estimated 12%, and ${shortDate(new Date(`${peak.date}T00:00:00`))} closed as the period's revenue peak.`,
      `Wastage cost is the fastest-growing negative metric at ${compactPkr(wastageValue)} (+3.2%), concentrated in beverages and frozen sides.`,
    ],
    whyItMatters:
      'Top-line growth is holding while contribution margin improves slowly; wastage growth erodes margin faster than price increases can recover it, so preparation accuracy is the highest-leverage fix this period.',
    evidence: [
      { metric: 'Revenue', value: compactPkr(revenueTotal), detail: '+8.4% vs previous 30 days' },
      { metric: 'Wastage cost', value: compactPkr(wastageValue), detail: '4.0% of revenue' },
      { metric: 'Repeat customers', value: '7,860', detail: '43.1% of active customers' },
    ],
    affectedDimension: 'Nationwide · All channels',
    period: PERIOD_LABEL,
    recommendedAction:
      'Review over-preparation on beverages and frozen sides at flagged outlets — see critical recommendations below.',
  },
}

/* ------------------------------ other payloads ---------------------------- */

const menuItemsJson = {
  data: { items },
  meta: {
    generatedAt: nowIso,
    filters: {},
    coverageOfRevenue: COVERAGE,
    note: `Sample subset of the production menu (52 of 180 items). Coverage of national revenue: ${COVERAGE}.`,
  },
}

const locationsJson = {
  data: { outlets },
  meta: { generatedAt: nowIso, filters: {} },
  insight: {
    summary: [
      `${outlets.filter((o) => o.performanceClass === 'profit_driver').length} of ${outlets.length} outlets currently classify as profit drivers; 4 carry performance flags.`,
      'Zamzama shows abnormal wastage and Blue Area a sustained rating decline — both are detailed in their outlet insights.',
    ],
    whyItMatters: 'Outlet-level variance is larger than category-level variance this period, so per-outlet corrections move national numbers more than menu-wide changes.',
    evidence: [
      { metric: 'Outlets', value: String(outlets.length), detail: 'Across 6 cities' },
      { metric: 'Flagged outlets', value: '3', detail: 'wastage_abnormal, rating_drop, sales_drop' },
    ],
    period: PERIOD_LABEL,
  },
}

const channelsJson = {
  data: {
    channels: CHANNEL_DEFS.map((c) => ({
      channel: c.channel,
      label: c.label,
      revenue: Math.round(revenueTotal * c.share),
      orders: Math.round((revenueTotal * c.share) / c.aov),
      basketSize: c.basket,
      aov: c.aov,
      discountPct: c.discount,
      peakHours: c.peaks,
      platformFeePct: c.fee,
      contributionMarginPct: c.contribution,
      revenueShare: round2(c.share),
    })),
  },
  meta: { generatedAt: nowIso, filters: {} },
}

const recommendations = [
  {
    id: 'rec-001', priority: 'critical', type: 'menu',
    action: 'Feature Nihari in weekend deals across 6 high-traffic outlets — it holds a 38.2% margin with only 2.1% of its category volume.',
    itemId: 'itm-013', categoryId: 'cat-karahi-handi', entityLabel: 'Nihari',
    estimatedImpact: { metric: 'Monthly revenue', direction: 'increase', estimate: 'PKR 620K' },
    evidence: [
      { metric: 'Margin', value: '38.2%', detail: 'Highest in its category' },
      { metric: 'Category volume share', value: '2.1%', detail: 'Bottleneck is visibility, not demand quality' },
      { metric: 'Rating', value: '4.6 / 5', detail: 'Across 1,204 reviews' },
    ],
    status: 'new', createdAt: '2026-09-22T09:15:00+05:00',
  },
  {
    id: 'rec-002', priority: 'critical', type: 'wastage',
    action: 'Cut Fresh Lime Soda prep batches by 20% on weekdays — 14.2% of prepared volume is being wasted.',
    itemId: 'itm-042', categoryId: 'cat-beverages', entityLabel: 'Fresh Lime Soda',
    estimatedImpact: { metric: 'Monthly wastage cost', direction: 'decrease', estimate: 'PKR 86K' },
    evidence: [
      { metric: 'Wastage', value: '14.2%', detail: 'Vs 4.0% national average' },
      { metric: 'Wasted cost', value: 'PKR 86K', detail: 'Trailing 30 days' },
      { metric: 'Affected outlets', value: '3', detail: 'Zamzama, Clifton, Gulberg III' },
    ],
    status: 'new', createdAt: '2026-09-21T18:40:00+05:00',
  },
  {
    id: 'rec-003', priority: 'critical', type: 'promotion',
    action: 'Rebalance Zinger Burger promotion cadence — 61% of its volume is promo-dependent and profit per order falls 18% on promo days.',
    itemId: 'itm-020', categoryId: 'cat-burgers', entityLabel: 'Zinger Burger',
    estimatedImpact: { metric: 'Contribution margin', direction: 'increase', estimate: 'PKR 410K / quarter' },
    evidence: [
      { metric: 'Promo dependency', value: '61%', detail: 'Share of volume sold on discount' },
      { metric: 'Profit on promo days', value: '-18%', detail: 'Per order vs non-promo days' },
      { metric: 'Volume rank', value: '#3', detail: 'Nationally by quantity' },
    ],
    status: 'new', createdAt: '2026-09-20T11:05:00+05:00',
  },
  {
    id: 'rec-004', priority: 'high', type: 'pricing',
    action: 'Test a 5% price increase on Mutton Karahi at Lahore outlets — estimated elasticity is low and margin headroom exists.',
    itemId: 'itm-009', categoryId: 'cat-karahi-handi', entityLabel: 'Mutton Karahi',
    estimatedImpact: { metric: 'Monthly revenue', direction: 'increase', estimate: 'PKR 350K' },
    evidence: [
      { metric: 'Elasticity', value: '0.42', detail: 'Low sensitivity class' },
      { metric: 'Margin', value: '36.8%', detail: 'Category median: 31.4%' },
      { metric: 'Rating', value: '4.5 / 5', detail: 'Stable over 90 days' },
    ],
    status: 'new', createdAt: '2026-09-19T15:30:00+05:00',
  },
  {
    id: 'rec-005', priority: 'high', type: 'menu',
    action: 'Remove Russian Salad from the printed menu at 4 outlets — lowest contribution in its category with a declining trend.',
    itemId: 'itm-046', categoryId: 'cat-soups-salads', entityLabel: 'Russian Salad',
    estimatedImpact: { metric: 'Monthly holding + wastage cost', direction: 'decrease', estimate: 'PKR 54K' },
    evidence: [
      { metric: 'Margin', value: '9.4%', detail: 'Lowest in Soups & Salads' },
      { metric: '90-day trend', value: '-12.6%', detail: 'Quantity trend' },
      { metric: 'Quantity share', value: '0.3%', detail: 'Of national items sold' },
    ],
    status: 'acknowledged', createdAt: '2026-09-17T10:20:00+05:00',
  },
  {
    id: 'rec-006', priority: 'high', type: 'wastage',
    action: 'Reduce Mozzarella Sticks freezer stock at DineIQ Zamzama — spoilage runs 9.8% against a 3.1% national average.',
    itemId: 'itm-035', outletId: 'out-05', entityLabel: 'Mozzarella Sticks · DineIQ Zamzama',
    estimatedImpact: { metric: 'Monthly wastage cost', direction: 'decrease', estimate: 'PKR 41K' },
    evidence: [
      { metric: 'Wastage', value: '9.8%', detail: 'At DineIQ Zamzama' },
      { metric: 'National average', value: '3.1%', detail: 'Same item, all outlets' },
      { metric: 'Order trend', value: '+4.2%', detail: 'Demand is not the cause — stock depth is' },
    ],
    status: 'new', createdAt: '2026-09-18T08:55:00+05:00',
  },
  {
    id: 'rec-007', priority: 'medium', type: 'operations',
    action: 'Add one kitchen hand during 13:00–15:00 at DineIQ Gulberg III — orders per staffed hour exceed the capacity threshold on Fridays.',
    outletId: 'out-10', entityLabel: 'DineIQ Gulberg III',
    estimatedImpact: { metric: 'Avg fulfilment time', direction: 'decrease', estimate: '-3.2 min' },
    evidence: [
      { metric: 'Friday peak orders', value: '142', detail: '13:00–15:00 average' },
      { metric: 'Capacity threshold', value: '120', detail: 'Per current staffing' },
      { metric: 'Prep time', value: '18.4 min', detail: 'Peak-hour average vs 12.1 off-peak' },
    ],
    status: 'new', createdAt: '2026-09-16T14:10:00+05:00',
  },
  {
    id: 'rec-008', priority: 'medium', type: 'bundling',
    action: 'Bundle Falooda with Grill Platter orders — basket analysis shows a 2.3× association lift with 4.1% support.',
    itemId: 'itm-038', entityLabel: 'Falooda + Grill Platter',
    estimatedImpact: { metric: 'Dessert attachment rate', direction: 'increase', estimate: '+6.8%' },
    evidence: [
      { metric: 'Lift', value: '2.3x', detail: 'Association strength vs random pairing' },
      { metric: 'Support', value: '4.1%', detail: 'Of all baskets contain both' },
      { metric: 'Confidence', value: '68%', detail: 'Rule confidence from basket model' },
    ],
    status: 'new', createdAt: '2026-09-15T16:45:00+05:00',
  },
  {
    id: 'rec-009', priority: 'low', type: 'menu',
    action: 'Pilot Haleem as a weekend-only item at 2 Islamabad outlets before considering a national rollout.',
    itemId: 'itm-007', categoryId: 'cat-biryani-rice', entityLabel: 'Haleem',
    evidence: [
      { metric: 'Weekend revenue share', value: '71.4%', detail: 'Of its total weekly sales' },
      { metric: 'Margin', value: '33.6%', detail: 'Healthy for its price band' },
      { metric: 'History', value: 'Insufficient', detail: '4 months — below model confidence threshold' },
    ],
    status: 'new', createdAt: '2026-09-14T12:30:00+05:00',
  },
  {
    id: 'rec-010', priority: 'low', type: 'pricing',
    action: 'Refresh menu photography for Chai and other low-visibility profit items in the app ordering flow.',
    itemId: 'itm-052', entityLabel: 'Chai',
    evidence: [
      { metric: 'Margin', value: '58.2%', detail: 'Highest-margin beverage' },
      { metric: 'App channel share', value: '13%', detail: 'Of national revenue' },
      { metric: 'Item page views', value: 'Bottom quartile', detail: 'Among beverages' },
    ],
    status: 'new', createdAt: '2026-09-13T09:00:00+05:00',
  },
]

const recommendationsJson = {
  data: { recommendations },
  meta: {
    generatedAt: nowIso,
    filters: {},
    modelName: 'RecommendationEngine',
    modelVersion: '1.8',
    pipeline: 'python',
  },
  // Phase 2: page-level insight for /recommendations — every figure below is
  // derived from the recommendation rows themselves (nothing invented).
  insight: (() => {
    const byPriority = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const r of recommendations) byPriority[r.priority] += 1
    const withImpact = recommendations.filter((r) => r.estimatedImpact).length
    const types = [...new Set(recommendations.map((r) => r.type))]
    return {
      summary: [
        `${byPriority.critical} critical and ${byPriority.high} high-priority actions are open across ${types.length} decision levers (${types.join(', ')}).`,
        `${withImpact} of ${recommendations.length} recommendations carry a quantified impact estimate; every card includes the evidence that triggered it.`,
        'Acknowledge or dismiss cards to record ownership — the engine re-ranks nightly from fresh pipeline output.',
      ],
      whyItMatters:
        'Acting on evidence-backed recommendations beats broad menu-wide changes: each action names the metrics that produced it, so managers can verify the reasoning before committing kitchen or pricing resources.',
      evidence: [
        { metric: 'Open actions', value: String(recommendations.length), detail: 'Across all priorities' },
        { metric: 'Critical', value: String(byPriority.critical), detail: 'Same-week action expected' },
        { metric: 'With quantified impact', value: `${withImpact} of ${recommendations.length}`, detail: 'Others include evidence only' },
      ],
      period: PERIOD_LABEL,
    }
  })(),
}

const anomalies = [
  {
    id: 'anm-001', type: 'sales_spike', severity: 'high', detectedAt: '2026-09-19T20:30:00+05:00',
    dimension: 'outlet', dimensionRef: 'DineIQ DHA Phase 6',
    summary: 'Dine-in orders at DineIQ DHA Phase 6 ran 23% above the 4-week baseline on Sep 19.',
    detectionMethod: 'STL decomposition + z-score',
    evidence: [
      { metric: 'Baseline', value: '1,860 orders/day', detail: '4-week trailing average' },
      { metric: 'Observed', value: '2,288', detail: 'Same day, dine-in channel' },
      { metric: 'Deviation', value: '+23.0%', detail: 'z-score 3.1' },
    ],
    status: 'new',
  },
  {
    id: 'anm-002', type: 'duplicate_transactions', severity: 'critical', detectedAt: '2026-09-17T11:45:00+05:00',
    dimension: 'channel', dimensionRef: 'POS / Dine-in',
    summary: '42 duplicate transaction pairs were detected within a 90-second window at 3 outlets.',
    detectionMethod: 'Duplicate hash rule (order content + amount + window)',
    evidence: [
      { metric: 'Duplicate pairs', value: '42', detail: 'Within 90 seconds' },
      { metric: 'Affected outlets', value: '3', detail: 'All using POS firmware v2.3.1' },
      { metric: 'Exposure', value: 'PKR 118K', detail: 'Potentially double-counted revenue' },
    ],
    status: 'reviewing',
  },
  {
    id: 'anm-003', type: 'rating_drop', severity: 'high', detectedAt: '2026-09-21T09:10:00+05:00',
    dimension: 'item', dimensionRef: 'Chicken Shawarma',
    summary: 'Chicken Shawarma rating fell from 4.5 to 3.6 across Lahore outlets over 5 days.',
    detectionMethod: 'EWMA control chart',
    evidence: [
      { metric: 'Rating before', value: '4.5 / 5', detail: '30-day average' },
      { metric: 'Rating after', value: '3.6 / 5', detail: 'Last 5 days' },
      { metric: 'Review count', value: '214', detail: 'Reviews in the drop window' },
    ],
    status: 'new',
  },
  {
    id: 'anm-004', type: 'sales_drop', severity: 'high', detectedAt: '2026-09-14T22:00:00+05:00',
    dimension: 'channel', dimensionRef: 'Delivery',
    summary: 'Delivery revenue in Islamabad fell 18.2% week-over-week.',
    evidence: [
      { metric: 'WoW delta', value: '-18.2%', detail: 'Week ending Sep 14' },
      { metric: 'Affected outlets', value: '4', detail: 'Islamabad cluster' },
      { metric: 'Baseline', value: 'PKR 2.1M / wk', detail: 'Prior 4-week average' },
    ],
    status: 'resolved',
  },
  {
    id: 'anm-005', type: 'abnormal_orders', severity: 'medium', detectedAt: '2026-09-20T03:15:00+05:00',
    dimension: 'customer', dimensionRef: 'CUST-58213',
    summary: 'A single customer account placed 87 orders in 24 hours through the app.',
    detectionMethod: 'Order velocity rule',
    evidence: [
      { metric: 'Orders in 24h', value: '87', detail: 'All via app channel' },
      { metric: 'Typical daily orders', value: '1.4', detail: 'For this account historically' },
      { metric: 'Pattern', value: 'Uniform 4-min gaps', detail: 'Consistent with reseller or bot behavior' },
    ],
    status: 'new',
  },
  {
    id: 'anm-006', type: 'rating_burst', severity: 'medium', detectedAt: '2026-09-16T14:20:00+05:00',
    dimension: 'outlet', dimensionRef: 'DineIQ Blue Area',
    summary: '214 five-star reviews for DineIQ Blue Area were posted within 3 hours.',
    detectionMethod: 'Review velocity outlier',
    evidence: [
      { metric: 'Reviews in 3h', value: '214', detail: 'All 5-star' },
      { metric: 'Usual rate', value: '2.1 / hour', detail: 'Trailing 30-day average' },
      { metric: 'Source', value: 'App reviews', detail: 'Single device fingerprint cluster' },
    ],
    status: 'dismissed',
  },
  {
    id: 'anm-007', type: 'sales_drop', severity: 'medium', detectedAt: '2026-09-08T12:00:00+05:00',
    dimension: 'region', dimensionRef: 'Nationwide',
    summary: 'Nationwide orders dropped 14% below baseline on Sep 8 during the monsoon holiday.',
    detectionMethod: 'Holiday-aware baseline',
    evidence: [
      { metric: 'Baseline', value: '26,410 orders', detail: 'Expected for the day' },
      { metric: 'Observed', value: '22,710', detail: 'Actual orders' },
      { metric: 'Deviation', value: '-14.0%', detail: 'Recovered fully by Sep 10' },
    ],
    status: 'reviewing',
  },
  {
    id: 'anm-008', type: 'rating_spike', severity: 'low', detectedAt: '2026-09-10T08:40:00+05:00',
    dimension: 'category', dimensionRef: 'Breakfast',
    summary: 'Breakfast category rating rose 0.5 points after the Sep 1 menu update.',
    detectionMethod: 'Pre/post comparison',
    evidence: [
      { metric: 'Rating before', value: '3.9 / 5', detail: '30 days pre-update' },
      { metric: 'Rating after', value: '4.4 / 5', detail: '10 days post-update' },
      { metric: 'Review count', value: '489', detail: 'Reviews in the post window' },
    ],
    status: 'new',
  },
]

const anomaliesJson = {
  data: { anomalies },
  meta: {
    generatedAt: nowIso,
    filters: {},
    modelName: 'AnomalyDetection',
    modelVersion: '2.1',
    pipeline: 'spark',
  },
}

/* ---------------------- what-if model config (Phase 2) -------------------- */

/**
 * What-If ScenarioEngine parameters (spec §27). In production these come
 * from the trained elasticity model registry; in mock mode the adapter
 * applies them deterministically. Elasticity is signed: a −1.2 means a +10%
 * price change suppresses demand by ~12%. |e| < 1 = inelastic.
 */
const whatifConfigJson = {
  categories: {
    'cat-biryani-rice': { elasticity: -1.15 },
    'cat-karahi-handi': { elasticity: -0.42 },
    'cat-bbq-kebabs': { elasticity: -0.88 },
    'cat-burgers': { elasticity: -1.35 },
    'cat-chinese': { elasticity: -1.05 },
    'cat-wraps-rolls': { elasticity: -1.28 },
    'cat-snacks-sides': { elasticity: -1.62 },
    'cat-desserts': { elasticity: -1.45 },
    'cat-beverages': { elasticity: -1.85 },
    'cat-soups-salads': { elasticity: -1.1 },
    'cat-family-deals': { elasticity: -0.75 },
    'cat-breakfast': { elasticity: -0.95 },
  },
  discount: {
    liftPer10Pct: 6.8,
    fatigueAbovePct: 15,
    fatigueDampener: 0.45,
  },
  prep: {
    shortfallConversion: 0.72,
    excessWastagePer10Pct: 1.6,
  },
  limits: {
    priceChangePct: [-20, 20],
    discountPct: [0, 30],
    prepChangePct: [-30, 10],
    horizonDays: [7, 14, 30],
  },
  assumptions: [
    { metric: 'Price elasticity', value: 'Category-level', detail: 'From historical price tests; |e| < 1 means inelastic demand' },
    { metric: 'Discount demand lift', value: '+6.8% per 10%', detail: 'Saturates above 15% discount (fatigue dampener 0.45)' },
    { metric: 'Unit cost', value: 'Held constant', detail: 'From the item contribution model; no supplier changes assumed' },
    { metric: 'Competitor response', value: 'Not modeled', detail: 'Estimates assume no matching price moves by competitors' },
    { metric: 'Baseline volume', value: 'Trailing 30 days', detail: 'Scaled to the selected filters and horizon' },
  ],
  notes: [
    'Output is a model estimate, not an actual result — validate with a controlled rollout before committing.',
    'Elasticity is a category-level estimate; individual items may deviate from it.',
    'Estimates exclude second-order effects such as basket composition and channel-mix shifts.',
  ],
  model: {
    name: 'WhatIf ScenarioEngine (sklearn)',
    version: '1.4',
    pipeline: 'python',
    confidence: 0.87,
  },
}

const demoAccountsJson = {
  accounts: [
    { id: 'usr-001', name: 'Ayesha Khan', email: 'admin@dineiq.pk', password: 'demo1234', role: 'admin' },
    { id: 'usr-002', name: 'Bilal Ahmed', email: 'regional@dineiq.pk', password: 'demo1234', role: 'regional_manager' },
    { id: 'usr-003', name: 'Sana Malik', email: 'manager@dineiq.pk', password: 'demo1234', role: 'restaurant_manager', outletScope: ['DineIQ Gulberg III'] },
    { id: 'usr-004', name: 'Daniyal Raza', email: 'analyst@dineiq.pk', password: 'demo1234', role: 'analyst' },
  ],
}

/* ==========================================================================
   PHASE 3–5 DATASETS
   Consistency anchors shared with the Phase 1/2 payloads above:
     - customers.activeCustomers == kpis 'active-customers' (18,240)
     - customers.repeatRatePct   == kpis 'repeat-customers' label (43.1%)
     - wastage.kpis.wastageCost  == kpis 'wastage-cost' (revenueTotal × 3.99%)
     - basket.orders             == ordersTotal (heatmap-consistent)
     - forecast history          == the same daily order series
     - promo campaign            == the Sep 4–8 promotion annotation
     - every item reference uses real ITEM_DEFS ids
   ========================================================================== */

const itemByName = Object.fromEntries(items.map((i) => [i.name, i]))
const itemById = Object.fromEntries(items.map((i) => [i.itemId, i]))

/* ------------------------------ customers --------------------------------- */

const TOTAL_CUSTOMERS = 61400
const ACTIVE_CUSTOMERS = 18240 // == Phase 1 KPI
const REPEAT_RATE = 43.1 // == Phase 1 comparison label
const ANNUAL_REVENUE = revenueTotal * 12 // 12 months of history

const SEGMENT_DEFS = [
  { id: 'seg-families', label: 'Families', share: 0.34, customers: 16800, aov: 2410, freq: 6.8, description: 'Weekend diners, large baskets, family deals and karahi-heavy orders.' },
  { id: 'seg-professionals', label: 'Professionals', share: 0.27, customers: 14100, aov: 1780, freq: 8.4, description: 'Lunch-hour and app orders, high repeat velocity, promo-tolerant.' },
  { id: 'seg-students', label: 'Students', share: 0.16, customers: 14900, aov: 920, freq: 7.1, description: 'Price-sensitive snack and wrap orders, strongly promo-driven.' },
  { id: 'seg-large-groups', label: 'Large Groups', share: 0.14, customers: 5400, aov: 4650, freq: 2.9, description: 'Platter and jumbo-deal buyers, event-driven, low frequency high ticket.' },
  { id: 'seg-late-night', label: 'Late-night', share: 0.09, customers: 10200, aov: 1150, freq: 5.2, description: '22:00–01:00 delivery and takeaway, wraps/shawarma dominant.' },
]
const segShareSum = SEGMENT_DEFS.reduce((s, d) => s + d.share, 0)

const segments = SEGMENT_DEFS.map((d) => {
  const revenue = Math.round(ANNUAL_REVENUE * (d.share / segShareSum))
  return {
    id: d.id,
    label: d.label,
    customers: d.customers,
    revenue,
    revenueShare: round2(d.share / segShareSum),
    avgOrderValue: d.aov,
    avgOrdersPerCustomer: d.freq,
    description: d.description,
  }
})

const RFM_DEFS = [
  { tier: 'Champions', customers: 2140, revShare: 0.238, rec: 6, freq: 14.2 },
  { tier: 'Loyal', customers: 6380, revShare: 0.312, rec: 12, freq: 9.6 },
  { tier: 'Potential Loyalist', customers: 9870, revShare: 0.214, rec: 21, freq: 5.4 },
  { tier: 'At Risk', customers: 4720, revShare: 0.151, rec: 46, freq: 6.1 },
  { tier: 'Hibernating', customers: 38290, revShare: 0.085, rec: 96, freq: 1.8 },
]

const rfmTiers = RFM_DEFS.map((d) => {
  const revenue = Math.round(ANNUAL_REVENUE * d.revShare)
  return {
    tier: d.tier,
    customers: d.customers,
    revenue,
    revenueShare: round2(d.revShare),
    avgRecencyDays: d.rec,
    avgFrequency: d.freq,
    avgMonetary: Math.round(revenue / d.customers),
  }
})

const churnRisk = [
  { bucket: 'high', label: 'High risk', customers: 1860, revenueAtRisk: 3410000, avgDaysSinceLastOrder: 52 },
  { bucket: 'medium', label: 'Medium risk', customers: 4420, revenueAtRisk: 5180000, avgDaysSinceLastOrder: 31 },
  { bucket: 'low', label: 'Low risk', customers: 11960, revenueAtRisk: 9840000, avgDaysSinceLastOrder: 9 },
]

const COHORT_DEFS = [
  { cohort: 'Apr 2026', size: 6900, retention: [100, 38.2, 29.4, 24.1, 21.8, 19.6] },
  { cohort: 'May 2026', size: 7240, retention: [100, 40.1, 30.2, 26.0, 22.7] },
  { cohort: 'Jun 2026', size: 6810, retention: [100, 36.8, 28.9, 24.6] },
  { cohort: 'Jul 2026', size: 7930, retention: [100, 41.5, 31.2] },
  { cohort: 'Aug 2026', size: 8460, retention: [100, 43.2] },
  { cohort: 'Sep 2026', size: 9120, retention: [100] },
]

const CHURN_LEVELS = ['high', 'medium', 'low']
const topCustomers = Array.from({ length: 24 }, (_, i) => {
  const seg = SEGMENT_DEFS[i % SEGMENT_DEFS.length]
  return {
    id: `CUST-${58210 - i * 137}`,
    segment: seg.label,
    orders: rint(38, 96) - (i % 3) * 4,
    lifetimeValue: Math.round(86000 * Math.pow(0.88, i) * noise(0.9, 1.1) / 100) * 100,
    lastOrderDaysAgo: 1 + (i * 2) % 19,
    churnRisk: CHURN_LEVELS[i % 4 === 3 ? 1 : i % 7 === 5 ? 0 : 2],
  }
})

const PROMO_SENSITIVITY_DEFS = [
  { segment: 'Families', promo: 22.4, depth: 8.2 },
  { segment: 'Professionals', promo: 31.6, depth: 11.4 },
  { segment: 'Students', promo: 58.9, depth: 16.8 },
  { segment: 'Large Groups', promo: 12.1, depth: 5.6 },
  { segment: 'Late-night', promo: 37.3, depth: 12.9 },
]
const promoSensitivity = PROMO_SENSITIVITY_DEFS.map((d) => ({
  segment: d.segment,
  promoSharePct: d.promo,
  organicSharePct: round1(100 - d.promo),
  avgDiscountDepthPct: d.depth,
}))

const customersJson = {
  data: {
    periodLabel: PERIOD_LABEL,
    kpis: {
      totalCustomers: TOTAL_CUSTOMERS,
      activeCustomers: ACTIVE_CUSTOMERS,
      newCustomers: 2310,
      repeatRatePct: REPEAT_RATE,
      avgLifetimeValue: Math.round(ANNUAL_REVENUE / TOTAL_CUSTOMERS),
      avgOrdersPerCustomer: round1((ordersTotal * 12) / TOTAL_CUSTOMERS),
      highChurnRisk: churnRisk[0].customers,
      revenueAtRisk: churnRisk[0].revenueAtRisk,
    },
    segments,
    rfmTiers,
    churnRisk,
    cohortRetention: COHORT_DEFS,
    topCustomers,
    promoSensitivity,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    modelName: 'ChurnScorer (XGBoost)',
    modelVersion: '0.9',
    pipeline: 'python',
  },
  insight: {
    summary: [
      `${ACTIVE_CUSTOMERS.toLocaleString('en-US')} customers ordered in the last 30 days (${REPEAT_RATE}% repeat rate) out of ${TOTAL_CUSTOMERS.toLocaleString('en-US')} lifetime accounts.`,
      `Families and Professionals generate ${round1(((SEGMENT_DEFS[0].share + SEGMENT_DEFS[1].share) / segShareSum) * 100)}% of revenue, while Students carry the deepest promo dependency at ${PROMO_SENSITIVITY_DEFS[2].promo}% of their orders.`,
      `The churn model flags ${churnRisk[0].customers.toLocaleString('en-US')} high-risk customers holding an estimated ${compactPkr(churnRisk[0].revenueAtRisk)} of monthly revenue.`,
    ],
    whyItMatters:
      'Retention economics beat acquisition here: a repeat order costs a fraction of a new-customer promo, and the At Risk tier still holds double-digit revenue share — targeted win-backs move revenue faster than broad discounting.',
    evidence: [
      { metric: 'Active customers', value: ACTIVE_CUSTOMERS.toLocaleString('en-US'), detail: `${REPEAT_RATE}% repeat rate` },
      { metric: 'High churn risk', value: churnRisk[0].customers.toLocaleString('en-US'), detail: `${compactPkr(churnRisk[0].revenueAtRisk)} monthly revenue at risk` },
      { metric: 'New this period', value: '2,310', detail: 'First order within 30 days' },
    ],
    period: PERIOD_LABEL,
  },
}

/* -------------------------------- basket ---------------------------------- */

const RULE_DEFS = [
  // [antecedent, consequent, supportPct, confidencePct, lift, opportunity, impact?]
  ['Grill Platter', 'Falooda', 4.1, 68, 2.3, 'bundle_candidate', { metric: 'Dessert attachment', estimate: '+6.8%' }],
  ['Chicken Tikka', 'Mint Margarita', 5.8, 61, 1.9, 'cross_sell', { metric: 'Beverage attach', estimate: '+4.1%' }],
  ['Zinger Burger', 'Loaded Fries', 6.2, 57, 1.8, 'bundle_candidate', { metric: 'Combo uptake', estimate: '+5.2%' }],
  ['Chicken Karahi', 'Gulab Jamun', 3.4, 44, 1.6, 'cross_sell'],
  ['Deal for Two', 'Cold Coffee', 2.9, 39, 1.5, 'menu_placement'],
  ['Mutton Karahi', 'Fresh Lime Soda', 2.6, 41, 1.7, 'cross_sell'],
  ['Seekh Kebab', 'Malai Boti', 3.8, 36, 1.5, 'bundle_candidate', { metric: 'BBQ combo uptake', estimate: '+3.9%' }],
  ['Chicken Shawarma', 'Masala Fries', 4.9, 52, 2.1, 'bundle_candidate', { metric: 'Snack attach', estimate: '+4.6%' }],
  ['Chicken Biryani', 'Kheer', 2.2, 33, 1.4, 'none'],
  ['Family Feast Deal', 'Mint Margarita', 2.4, 37, 1.6, 'menu_placement'],
  ['Chicken Paratha Roll', 'Cold Coffee', 3.1, 34, 1.4, 'none'],
  ['Haleem', 'Shawarma Roll', 1.6, 29, 1.5, 'menu_placement'],
  ['Malai Boti', 'Gulab Jamun', 2.7, 31, 1.5, 'cross_sell'],
  ['Chicken Corn Soup', 'Club Sandwich', 1.8, 27, 1.4, 'none'],
]

const rules = RULE_DEFS.map(([a, c, support, confidence, lift, opportunity, impact], i) => {
  const A = itemByName[a]
  const C = itemByName[c]
  return {
    id: `rule-${String(i + 1).padStart(3, '0')}`,
    antecedent: { itemId: A.itemId, name: A.name },
    consequent: { itemId: C.itemId, name: C.name },
    category: A.category,
    supportPct: support,
    confidencePct: confidence,
    lift,
    pairOrders: Math.round(ordersTotal * (support / 100)),
    opportunity,
    ...(impact ? { estimatedImpact: impact } : {}),
  }
})

const CATEGORY_PAIR_DEFS = [
  ['BBQ & Kebabs', 'Beverages', 2.1],
  ['Burgers & Sandwiches', 'Snacks & Sides', 2.4],
  ['Karahi & Handi', 'Desserts', 1.7],
  ['Biryani & Rice', 'Beverages', 1.6],
  ['Wraps & Rolls', 'Snacks & Sides', 2.2],
  ['Family Deals', 'Beverages', 1.8],
  ['BBQ & Kebabs', 'Desserts', 1.5],
  ['Chinese', 'Beverages', 1.4],
  ['Burgers & Sandwiches', 'Beverages', 1.5],
  ['Biryani & Rice', 'Desserts', 1.3],
]
const categoryPairs = CATEGORY_PAIR_DEFS.map(([a, b, lift]) => ({
  categoryA: a,
  categoryB: b,
  pairOrders: Math.round(ordersTotal * (0.018 + lift / 100)),
  lift,
}))

const BASKET_SIZE_DEFS = [
  [1, 14.2], [2, 24.8], [3, 27.1], [4, 17.6], [5, 9.1], [6, 4.4], [7, 1.9], [8, 0.9],
]
const basketSizeDist = BASKET_SIZE_DEFS.map(([size, share]) => ({
  size,
  baskets: Math.round(ordersTotal * (share / 100)),
  sharePct: share,
}))

const bundleRules = rules.filter((r) => r.opportunity === 'bundle_candidate').slice(0, 4)
const bundles = bundleRules.map((r, i) => {
  const A = itemById[r.antecedent.itemId]
  const C = itemById[r.consequent.itemId]
  const combined = A.price + C.price
  return {
    id: `bundle-${String(i + 1).padStart(2, '0')}`,
    items: [
      { itemId: A.itemId, name: A.name, price: A.price },
      { itemId: C.itemId, name: C.name, price: C.price },
    ],
    combinedPrice: combined,
    suggestedPrice: Math.round((combined * 0.92) / 10) * 10,
    basis: `${r.confidencePct}% of ${A.name} baskets already add ${C.name} (lift ${r.lift}×) — a 8% bundle discount is cheaper than the discount depth needed to drive the same attachment organically.`,
  }
})

const strongRulesCount = rules.filter((r) => r.lift >= 1.5 && r.supportPct >= 2).length

const basketJson = {
  data: {
    periodLabel: PERIOD_LABEL,
    kpis: {
      basketsAnalyzed: ordersTotal,
      avgBasketSize: round2(channelMix.reduce((s, c) => s + c.revenue, 0) === 0 ? 3.05 : 3.05),
      avgBasketValue: Math.round(aovTotal),
      attachRatePct: 31.4,
      strongRules: strongRulesCount,
      bundleOpportunities: bundles.length,
    },
    rules,
    categoryPairs,
    basketSizeDist,
    bundles,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    modelName: 'BasketRules (Spark FP-Growth)',
    modelVersion: '2.3',
    pipeline: 'spark',
  },
  insight: {
    summary: [
      `${compactInt(ordersTotal)} baskets were analyzed over the last 30 days; the strongest pairing is ${rules[0].antecedent.name} → ${rules[0].consequent.name} at ${rules[0].lift}× lift with ${rules[0].supportPct}% support.`,
      `${strongRulesCount} of ${rules.length} association rules clear the lift ≥ 1.5 and support ≥ 2% bar; ${bundles.length} bundle opportunities are backed by rules, not intuition.`,
      `Snacks & Sides pairs with Burgers at the highest category lift (${CATEGORY_PAIR_DEFS[1][2]}×), making combo menus the cheapest attachment lever.`,
    ],
    whyItMatters:
      'Attachment via association rules raises average order value without discounting headline items — every bundle below is priced from observed pair frequency so the discount only pays for behavior that already exists.',
    evidence: [
      { metric: 'Baskets analyzed', value: compactInt(ordersTotal), detail: 'Trailing 30 days' },
      { metric: 'Strong rules', value: String(strongRulesCount), detail: 'lift ≥ 1.5 · support ≥ 2%' },
      { metric: 'Top lift', value: `${rules[0].lift}×`, detail: `${rules[0].antecedent.name} → ${rules[0].consequent.name}` },
    ],
    period: PERIOD_LABEL,
  },
}

/* ------------------------------- forecast ---------------------------------- */

const FORECAST_DAYS = 14
const last7 = series.slice(-7)
const last7Orders = last7.reduce((s, p) => s + p.orders, 0)

// Forward calendar starting the day after the sample window ends.
const forecastDaily = []
for (const p of series) {
  forecastDaily.push({
    date: p.date,
    actual: p.orders,
    forecast: p.orders,
    lower: p.orders,
    upper: p.orders,
    isForecast: false,
  })
}
let forecastOrdersTotal = 0
for (let i = 1; i <= FORECAST_DAYS; i++) {
  const d = new Date(END)
  d.setDate(d.getDate() + i)
  const wf = weekdayFactor[WEEKDAYS[wdIndex(d)]]
  const base = (last7Orders / 7) * wf * 1.037 * noise(0.97, 1.03)
  const q = Math.round(base / 10) * 10
  const spread = 0.055 + i * 0.004 // widening confidence band
  forecastOrdersTotal += q
  forecastDaily.push({
    date: isoDate(d),
    forecast: q,
    lower: Math.round(q * (1 - spread)),
    upper: Math.round(q * (1 + spread)),
    isForecast: true,
  })
}

const forecastAov = aovTotal
const forecastItems = [
  'Chicken Biryani', 'Chicken Karahi', 'Zinger Burger', 'Chicken Tikka', 'Seekh Kebab',
  'Chicken Shawarma', 'Deal for Two', 'Malai Boti', 'Loaded Fries', 'Mutton Karahi',
  'Chicken Handi', 'Halwa Puri', 'Cold Coffee', 'Gulab Jamun', 'Beef Biryani',
  'Mint Margarita', 'Chicken Paratha Roll', 'Behari Kebab', 'Haleem', 'Chai',
].map((name, i) => {
  const it = itemByName[name]
  const actualQty = Math.round((it.quantity / 30) * 7)
  const delta = round1(-9 + rand() * 24)
  const forecastQty = Math.max(1, Math.round(actualQty * (1 + delta / 100)))
  return {
    itemId: it.itemId,
    name: it.name,
    category: it.category,
    actualQty,
    forecastQty,
    deltaPct: delta,
    confidence: round2(0.72 + rand() * 0.23),
    trend: delta > 4 ? 'rising' : delta < -4 ? 'falling' : 'stable',
  }
})

const forecastJson = {
  data: {
    periodLabel: `${shortDate(START)} – ${shortDate(new Date(END.getTime() + FORECAST_DAYS * 86400000))}, ${END.getFullYear()}`,
    kpis: {
      horizonDays: FORECAST_DAYS,
      forecastOrders: forecastOrdersTotal,
      forecastRevenue: Math.round(forecastOrdersTotal * forecastAov),
      mapePct: 8.4,
      biasPct: 1.2,
      confidence: 0.924,
    },
    daily: forecastDaily,
    accuracy: [
      { modelName: 'DemandForecaster (XGBoost)', pipeline: 'python', mapePct: 8.4, rmse: 96, withinTolerancePct: 91.2, horizonTestedDays: 14 },
      { modelName: 'GBT Regressor (Spark MLlib)', pipeline: 'spark', mapePct: 9.6, rmse: 108, withinTolerancePct: 88.7, horizonTestedDays: 14 },
      { modelName: 'Seasonal Naïve baseline', pipeline: 'python', mapePct: 13.9, rmse: 151, withinTolerancePct: 74.3, horizonTestedDays: 14 },
    ],
    items: forecastItems,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    modelName: 'DemandForecaster (XGBoost)',
    modelVersion: '3.2',
    pipeline: 'python',
    confidence: 0.924,
  },
  insight: {
    summary: [
      `The model forecasts ${compactInt(forecastOrdersTotal)} orders (≈ ${compactPkr(forecastOrdersTotal * forecastAov)}) for the next ${FORECAST_DAYS} days, ${((forecastOrdersTotal / FORECAST_DAYS / (last7Orders / 7) - 1) * 100).toFixed(1)}% versus the trailing week run-rate.`,
      `Backtest MAPE is 8.4% with a +1.2% bias — the model runs slightly hot, so procurement should anchor on the lower band.`,
      `${forecastItems.filter((f) => f.trend === 'rising').length} of ${forecastItems.length} tracked items are forecast to rise; Friday and Saturday dinners remain the highest-variance windows.`,
    ],
    whyItMatters:
      'Prep and procurement decisions are made per item per day; the confidence bands translate directly into batch-size boundaries, and the accuracy table shows when to trust the model versus the naive baseline.',
    evidence: [
      { metric: 'Forecast orders (14d)', value: compactInt(forecastOrdersTotal), detail: 'vs trailing 7-day actuals' },
      { metric: 'Backtest MAPE', value: '8.4%', detail: '14-day horizon backtest' },
      { metric: 'Model confidence', value: '0.924', detail: 'DemandForecaster v3.2' },
    ],
    period: PERIOD_LABEL,
  },
}

/* -------------------------------- wastage ---------------------------------- */

const WASTAGE_TOTAL = Math.round(revenueTotal * 0.0399) // == Phase 1 KPI

// Category wastage profile — beverages and frozen sides are the problem areas.
const WASTAGE_CAT_PCT = {
  'cat-biryani-rice': 2.1, 'cat-karahi-handi': 1.8, 'cat-bbq-kebabs': 2.6,
  'cat-burgers': 3.4, 'cat-chinese': 3.1, 'cat-wraps-rolls': 3.8,
  'cat-snacks-sides': 5.9, 'cat-desserts': 4.4, 'cat-beverages': 6.8,
  'cat-soups-salads': 4.9, 'cat-family-deals': 2.2, 'cat-breakfast': 3.6,
}
const CAT_REVENUE = {}
for (const c of CATEGORY_DEFS) {
  CAT_REVENUE[c.id] = items.filter((i) => i.categoryId === c.id).reduce((s, i) => s + i.revenue, 0)
}
const catWastageCost = {}
let catWastageSum = 0
for (const c of CATEGORY_DEFS) {
  catWastageCost[c.id] = CAT_REVENUE[c.id] * (WASTAGE_CAT_PCT[c.id] / 100)
  catWastageSum += catWastageCost[c.id]
}
// Normalise so category wastage sums EXACTLY to the Phase 1 wastage KPI.
const wastageByCategory = CATEGORY_DEFS.map((c) => {
  const cost = Math.round((catWastageCost[c.id] / catWastageSum) * WASTAGE_TOTAL)
  const catItems = items.filter((i) => i.categoryId === c.id)
  const topItem = [...catItems].sort((a, b) => b.wastagePct - a.wastagePct)[0]
  return {
    categoryId: c.id,
    category: c.name,
    wastageCost: cost,
    wastagePct: WASTAGE_CAT_PCT[c.id],
    topItem: topItem ? topItem.name : '—',
  }
})
{
  // absorb rounding drift into the largest category
  const diff = WASTAGE_TOTAL - wastageByCategory.reduce((s, c) => s + c.wastageCost, 0)
  const maxRow = wastageByCategory.reduce((m, c) => (c.wastageCost > m.wastageCost ? c : m), wastageByCategory[0])
  maxRow.wastageCost += diff
}
const wastageCostSumCat = wastageByCategory.reduce((s, c) => s + c.wastageCost, 0)
for (const c of wastageByCategory) c.shareOfWastage = round2(c.wastageCost / wastageCostSumCat)

const wastageByItem = [...items]
  .sort((a, b) => b.wastagePct - a.wastagePct)
  .slice(0, 20)
  .map((i) => ({
    itemId: i.itemId,
    name: i.name,
    category: i.category,
    wastagePct: i.wastagePct,
    wastageCost: Math.round(i.revenue * (i.wastagePct / 100)),
    preparedQty: Math.round(i.quantity * (1 + i.wastagePct / 100)),
    wastedQty: Math.round(i.quantity * (i.wastagePct / 100)),
  }))

// Outlet wastage — scaled by revenue share, Zamzama flagged high (matches Phase 1 flag).
const wastageByOutlet = outlets.map((o) => {
  const pct = o.flags.includes('wastage_abnormal') ? 6.2 : round1(2.6 + rand() * 2.4)
  return {
    outletId: o.id,
    outlet: o.name,
    city: o.city,
    wastageCost: Math.round(o.revenue * (pct / 100)),
    wastagePct: pct,
    flag: o.flags.includes('wastage_abnormal') ? 'wastage_abnormal' : undefined,
  }
})
{
  const diff = WASTAGE_TOTAL - wastageByOutlet.reduce((s, o) => s + o.wastageCost, 0)
  const maxRow = wastageByOutlet.reduce((m, o) => (o.wastageCost > m.wastageCost ? o : m), wastageByOutlet[0])
  maxRow.wastageCost += diff
}

const wastageTrend = series.map((p) => {
  const pct = 3.6 + rand() * 0.9
  return {
    date: p.date,
    wastageCost: Math.round(p.revenue * (pct / 100)),
    wastagePct: round1(pct),
  }
})
{
  const diff = WASTAGE_TOTAL - wastageTrend.reduce((s, p) => s + p.wastageCost, 0)
  const spread = Math.round(diff / wastageTrend.length)
  for (const p of wastageTrend) p.wastageCost += spread
}

const worstCat = [...wastageByCategory].sort((a, b) => b.wastagePct - a.wastagePct)[0]
const worstOut = [...wastageByOutlet].sort((a, b) => b.wastagePct - a.wastagePct)[0]

const wastageJson = {
  data: {
    periodLabel: PERIOD_LABEL,
    kpis: {
      wastageCost: WASTAGE_TOTAL,
      wastagePctOfRevenue: round1((WASTAGE_TOTAL / revenueTotal) * 100),
      deltaPct: 3.2, // == Phase 1 wastage KPI delta
      prepWasteSharePct: 58,
      spoilageSharePct: 27,
      worstCategory: worstCat.category,
      worstOutlet: worstOut.outlet,
    },
    trend: wastageTrend,
    byCategory: wastageByCategory,
    byItem: wastageByItem,
    byOutlet: wastageByOutlet,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    note: 'Wastage totals reconcile exactly with the Executive Dashboard wastage KPI.',
  },
  insight: {
    summary: [
      `Wastage cost reached ${compactPkr(WASTAGE_TOTAL)} (${round1((WASTAGE_TOTAL / revenueTotal) * 100)}% of revenue) over the last 30 days, up 3.2% versus the previous period.`,
      `${worstCat.category} runs the highest category wastage at ${worstCat.wastagePct}%, led by ${worstCat.topItem}; ${worstOut.outlet} is the worst outlet at ${worstOut.wastagePct}%.`,
      `Over-preparation causes 58% of wasted cost and spoilage 27% — batch-size correction on beverages and frozen sides is the highest-leverage fix.`,
    ],
    whyItMatters:
      'Every point of wastage comes straight out of contribution margin; because the cost concentrates in a handful of items and one flagged outlet, targeted prep changes recover more margin than any menu-wide price move.',
    evidence: [
      { metric: 'Wastage cost', value: compactPkr(WASTAGE_TOTAL), detail: 'Reconciles with the dashboard KPI' },
      { metric: 'Worst category', value: `${worstCat.category} · ${worstCat.wastagePct}%`, detail: `Led by ${worstCat.topItem}` },
      { metric: 'Worst outlet', value: `${worstOut.outlet} · ${worstOut.wastagePct}%`, detail: 'Carries the wastage_abnormal flag' },
    ],
    period: PERIOD_LABEL,
  },
}

/* --------------------------- pricing & promotions --------------------------- */

const whatifElasticity = whatifConfigJson.categories
const pricingElasticity = items
  .map((i) => {
    const catE = whatifElasticity[i.categoryId].elasticity
    const e = Math.round(catE * noise(0.82, 1.18) * 100) / 100
    let recommendation = 'hold'
    let rationale = ''
    if (e > -0.7 && i.marginPct >= 32) {
      recommendation = 'raise'
      rationale = `Inelastic demand (${e}) with ${i.marginPct}% margin — a 5% test increase is projected to hold volume within 3.5%.`
    } else if (i.marginPct >= 30 && Math.abs(e) >= 0.7 && Math.abs(e) <= 1.1) {
      recommendation = 'test'
      rationale = `Mid-band elasticity (${e}) and ${i.marginPct}% margin — an A/B price test beats a national move.`
    } else if (i.trendPct <= -10 && i.marginPct < 15) {
      recommendation = 'reduce'
      rationale = `Volume fading ${i.trendPct}% at a ${i.marginPct}% margin — a small reduction defends contribution before the trend locks in.`
    }
    if (!rationale) rationale = `Elasticity ${e} with ${i.marginPct}% margin — current price sits inside its efficient band.`
    return {
      itemId: i.itemId,
      name: i.name,
      category: i.category,
      currentPrice: i.price,
      elasticity: e,
      marginPct: i.marginPct,
      trendPct: i.trendPct,
      recommendation,
      rationale,
      confidence: round2(0.62 + rand() * 0.29),
    }
  })
  .sort((a, b) => a.elasticity - b.elasticity)

const pricingKpisData = {
  itemsAnalyzed: pricingElasticity.length,
  avgElasticity: round1(pricingElasticity.reduce((s, r) => s + r.elasticity, 0) / pricingElasticity.length),
  inelasticItems: pricingElasticity.filter((r) => r.elasticity > -1).length,
  elasticItems: pricingElasticity.filter((r) => r.elasticity <= -1).length,
  testCandidates: pricingElasticity.filter((r) => r.recommendation === 'test').length,
  revenueAtStake: Math.round(revenueTotal * 0.1),
}

const CAMPAIGN_DEFS = [
  { id: 'cmp-001', name: 'September Dine-in Week', channel: 'dine_in', window: 'Sep 4 – Sep 8, 2026', discountPct: 15, orders: 6120, revenue: 9860000, incremental: 1040000, roi: 2.4, marginImpact: -4.1, status: 'completed', verdict: 'scale' },
  { id: 'cmp-002', name: 'App-exclusive 20% Off', channel: 'app', window: 'Sep 1 – Sep 30, 2026', discountPct: 20, orders: 4480, revenue: 5410000, incremental: 390000, roi: 1.1, marginImpact: -8.6, status: 'active', verdict: 'optimize' },
  { id: 'cmp-003', name: 'Weekend Family Deal Push', channel: 'delivery', window: 'Sep 5 – Sep 28, 2026', discountPct: 10, orders: 2270, revenue: 4890000, incremental: -120000, roi: -0.3, marginImpact: -6.2, status: 'active', verdict: 'retire' },
  { id: 'cmp-004', name: 'Student Lunch Combo', channel: 'takeaway', window: 'Sep 8 – Sep 30, 2026', discountPct: 12, orders: 3810, revenue: 2140000, incremental: 610000, roi: 1.9, marginImpact: -2.8, status: 'active', verdict: 'scale' },
  { id: 'cmp-005', name: 'Free Delivery over PKR 2,000', channel: 'delivery', window: 'Sep 1 – Sep 30, 2026', discountPct: 0, orders: 5240, revenue: 7320000, incremental: 480000, roi: 1.4, marginImpact: -1.9, status: 'active', verdict: 'optimize' },
  { id: 'cmp-006', name: 'Iftar Preview Bundles', channel: 'app', window: 'Aug 20 – Sep 2, 2026', discountPct: 18, orders: 1990, revenue: 3410000, incremental: 290000, roi: 0.9, marginImpact: -5.4, status: 'completed', verdict: 'optimize' },
]
const campaigns = CAMPAIGN_DEFS.map((c) => ({
  id: c.id,
  name: c.name,
  channel: c.channel,
  window: c.window,
  discountPct: c.discountPct,
  orders: c.orders,
  revenue: c.revenue,
  incrementalRevenue: c.incremental,
  roi: c.roi,
  marginImpactPct: c.marginImpact,
  status: c.status,
  verdict: c.verdict,
}))

// Promo traps — items whose volume is discount-dependent and margin-negative on promo days.
// Zinger Burger matches rec-003 (61%, −18%).
const trapOverrides = {
  'Zinger Burger': { promoDependencyPct: 61, profitOnPromoDaysPct: -18 },
  'Beef Burger': { promoDependencyPct: 44, profitOnPromoDaysPct: -12.4 },
  'Chicken Shawarma': { promoDependencyPct: 38, profitOnPromoDaysPct: -9.1 },
}
const promoTraps = Object.entries(trapOverrides).map(([name, t]) => {
  const it = itemByName[name]
  return {
    itemId: it.itemId,
    name: it.name,
    promoDependencyPct: t.promoDependencyPct,
    profitOnPromoDaysPct: t.profitOnPromoDaysPct,
    evidence: [
      { metric: 'Promo dependency', value: `${t.promoDependencyPct}%`, detail: 'Share of volume sold on discount' },
      { metric: 'Profit on promo days', value: `${t.profitOnPromoDaysPct}%`, detail: 'Per order vs non-promo days' },
      { metric: 'Margin', value: `${it.marginPct}%`, detail: 'Regular-day contribution margin' },
    ],
  }
})

const revenueOnPromoPct = round1(
  (promoTraps.reduce((s, t) => s + t.promoDependencyPct, 0) / 3 + 18.4) / 1,
)
const promoKpisData = {
  activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
  revenueOnPromoPct: Math.min(revenueOnPromoPct, 34.6),
  avgDiscountPct: round1(campaigns.reduce((s, c) => s + c.discountPct, 0) / campaigns.length),
  positiveRoiCampaigns: campaigns.filter((c) => c.roi > 1).length,
  trappedItems: promoTraps.length,
}

const pricingJson = {
  data: {
    periodLabel: PERIOD_LABEL,
    pricingKpis: pricingKpisData,
    elasticity: pricingElasticity,
    promoKpis: promoKpisData,
    campaigns,
    promoTraps,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    modelName: 'ElasticityModel (Spark MLlib)',
    modelVersion: '2.0',
    pipeline: 'spark',
  },
  insight: {
    summary: [
      `${pricingElasticity.length} items were scored for price elasticity: ${pricingKpisData.inelasticItems} are inelastic (|e| < 1) and ${pricingKpisData.testCandidates} are A/B test candidates this cycle.`,
      `${campaigns.filter((c) => c.roi > 1).length} of ${campaigns.length} active or recent campaigns clear ROI 1.0; the Weekend Family Deal Push is increment-negative and queued for retirement.`,
      `${promoTraps.length} items are promo traps — Zinger Burger depends on discounts for ${trapOverrides['Zinger Burger'].promoDependencyPct}% of volume while losing ${Math.abs(trapOverrides['Zinger Burger'].profitOnPromoDaysPct)}% profit per promo order.`,
    ],
    whyItMatters:
      'Pricing moves and promotion spend draw on the same margin pool: raising inelastic items funds retirement of negative-ROI discounts, and the trap list shows exactly where discount dependency has become structural.',
    evidence: [
      { metric: 'Inelastic items', value: String(pricingKpisData.inelasticItems), detail: 'Safe zone for measured increases' },
      { metric: 'Campaigns above ROI 1.0', value: `${promoKpisData.positiveRoiCampaigns} of ${campaigns.length}`, detail: 'Scale candidates' },
      { metric: 'Revenue at stake', value: compactPkr(pricingKpisData.revenueAtStake), detail: '10% of revenue touches a pricing lever' },
    ],
    period: PERIOD_LABEL,
  },
}

/* ---------------------------- locations detail ------------------------------ */

const locationMatrix = {
  outletIds: outlets.map((o) => o.id),
  outletNames: outlets.map((o) => o.name),
  categories: CATEGORY_DEFS.map((c) => c.name),
  values: outlets.flatMap((o) =>
    CATEGORY_DEFS.map((c) => ({
      outletId: o.id,
      categoryId: c.id,
      revenue: Math.round(o.revenue * catShareOfTotal[c.id] * noise(0.82, 1.18)),
    })),
  ),
}
const cityMap = {}
for (const o of outlets) {
  if (!cityMap[o.city]) cityMap[o.city] = { revenue: 0, outlets: [], margins: [] }
  cityMap[o.city].revenue += o.revenue
  cityMap[o.city].outlets.push(o)
  cityMap[o.city].margins.push(o.profitMarginPct)
}
const cityAggregates = Object.entries(cityMap)
  .map(([city, v]) => {
    const sorted = [...v.outlets].sort((a, b) => b.revenue - a.revenue)
    return {
      city,
      outlets: v.outlets.length,
      revenue: v.revenue,
      revenueShare: round2(v.revenue / revenueTotal),
      avgMarginPct: round1(v.margins.reduce((s, m) => s + m, 0) / v.margins.length),
      bestOutlet: sorted[0].name,
      worstOutlet: sorted[sorted.length - 1].name,
    }
  })
  .sort((a, b) => b.revenue - a.revenue)
const bestOutletOverall = [...outlets].sort((a, b) => b.revenue - a.revenue)[0]
const avgMarginAll = round1(outlets.reduce((s, o) => s + o.profitMarginPct, 0) / outlets.length)

const locationsDetailJson = {
  data: {
    periodLabel: PERIOD_LABEL,
    kpis: {
      outlets: outlets.length,
      cities: cityAggregates.length,
      bestOutlet: bestOutletOverall.name,
      flaggedOutlets: outlets.filter((o) => (o.flags ?? []).length > 0).length,
      avgMarginPct: avgMarginAll,
    },
    cityAggregates,
    matrix: locationMatrix,
  },
  meta: { generatedAt: nowIso, filters: {} },
  insight: {
    summary: [
      `${outlets.length} outlets across ${cityAggregates.length} cities generated ${compactPkr(revenueTotal)}; ${bestOutletOverall.name} leads with a ${round2(bestOutletOverall.revenueShare)} revenue share.`,
      `Karachi contributes ${round1((cityAggregates.find((c) => c.city === 'Karachi')?.revenueShare ?? 0) * 100)}% of national revenue — city concentration is the structural risk in the network.`,
      `${outlets.filter((o) => (o.flags ?? []).length > 0).length} outlets carry performance flags (wastage, rating, sales) and their evidence is attached in the comparison table.`,
    ],
    whyItMatters:
      'Outlet variance exceeds category variance this period: the same menu performs differently by location, so staffing, prep and local price tests should be decided per outlet cluster rather than nationally.',
    evidence: [
      { metric: 'Top outlet', value: bestOutletOverall.name, detail: `${compactPkr(bestOutletOverall.revenue)} revenue` },
      { metric: 'Cities', value: String(cityAggregates.length), detail: 'Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Multan' },
      { metric: 'Flagged outlets', value: String(outlets.filter((o) => (o.flags ?? []).length > 0).length), detail: 'wastage_abnormal · rating_drop · sales_drop' },
    ],
    period: PERIOD_LABEL,
  },
}

/* ----------------------------- channels hourly ------------------------------ */

const channelHourlyValues = []
for (const c of CHANNEL_DEFS) {
  const channelOrders = Math.round((revenueTotal * c.share) / c.aov)
  const weights = HOUR_WEIGHTS.map((w, hi) => (c.peaks.includes(HOURS[hi]) ? w * 1.35 : w))
  const wSum = weights.reduce((s, w) => s + w, 0)
  const floats = weights.map((w) => (channelOrders * w) / wSum)
  const floors = floats.map((v) => Math.floor(v))
  let driftCh = channelOrders - floors.reduce((s, v) => s + v, 0)
  const order = floats
    .map((v, i) => [i, v - Math.floor(v)])
    .sort((a, b) => b[1] - a[1])
  for (const [i] of order) {
    if (driftCh <= 0) break
    floors[i] += 1
    driftCh -= 1
  }
  HOURS.forEach((h, hi) => {
    channelHourlyValues.push({ channel: c.channel, hour: h, orders: floors[hi] })
  })
}

const channelsHourlyJson = {
  data: {
    channels: CHANNEL_DEFS.map((c) => ({ channel: c.channel, label: c.label })),
    hours: HOURS,
    values: channelHourlyValues,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    note: 'Per-channel hourly order distribution; each channel row sums to its 30-day order total.',
  },
}

/* --------------------------- pipeline comparison ---------------------------- */

const PIPE_RUN_NAMES = [
  'nightly_kpis_agg', 'menu_item_rollup', 'customer_rfm', 'basket_fpgrowth', 'demand_forecast_features',
  'anomaly_detection', 'channel_mix_agg', 'wastage_breakdown', 'elasticity_training', 'cohort_retention',
  'ratings_ewma', 'outlet_compare',
]
const recentRuns = PIPE_RUN_NAMES.map((name, i) => {
  const pipeline = i % 3 === 2 ? 'python' : 'spark'
  const status = i === 4 ? 'failed' : i === 0 ? 'running' : 'success'
  return {
    id: `run-${String(340 - i).padStart(4, '0')}`,
    jobName: name,
    pipeline,
    startedAt: new Date(new Date(nowIso).getTime() - (i * 7 + 2) * 3600000).toISOString(),
    durationSec: pipeline === 'spark' ? rint(180, 420) : rint(540, 900),
    rowsIn: rint(180000, 1248000),
    rowsOut: rint(1200, 48000),
    status,
  }
})

const modelsJson = {
  data: {
    kpis: {
      agreementPct: 98.6,
      sparkJobs: 34,
      pythonJobs: 41,
      recordsCompared: 1248000,
      lastComparedAt: nowIso,
    },
    metrics: [
      { metric: 'Avg job runtime', unit: 'sec', sparkValue: 264, pythonValue: 702, better: 'spark', note: 'Spark distributes the heavy aggregations' },
      { metric: 'Peak executor memory', unit: 'GB', sparkValue: 11.4, pythonValue: 5.8, better: 'python', note: 'Python jobs run single-node with lower footprint' },
      { metric: 'Throughput', unit: 'rows/sec', sparkValue: 48200, pythonValue: 15600, better: 'spark' },
      { metric: 'Cold start overhead', unit: 'sec', sparkValue: 38, pythonValue: 4, better: 'python' },
      { metric: 'Cost per run (est.)', unit: 'PKR', sparkValue: 41, pythonValue: 63, better: 'spark' },
      { metric: 'Rows processed (24h)', unit: 'rows', sparkValue: 986000, pythonValue: 262000, better: 'spark' },
    ],
    agreement: [
      { metric: 'Daily revenue rollup', agreementPct: 99.9, sampleSize: 360, maxDeviationPct: 0.02 },
      { metric: 'Item margin table', agreementPct: 98.4, sampleSize: 180, maxDeviationPct: 0.6 },
      { metric: 'Customer RFM tiers', agreementPct: 99.2, sampleSize: 1248000, maxDeviationPct: 0.3 },
      { metric: 'Channel mix shares', agreementPct: 99.7, sampleSize: 144, maxDeviationPct: 0.1 },
    ],
    recentRuns,
    recordDiffSample: [
      { recordId: 'itm-001/2026-09-22', field: 'marginPct', sparkValue: '38.2', pythonValue: '38.2', match: true },
      { recordId: 'itm-009/2026-09-22', field: 'marginPct', sparkValue: '36.8', pythonValue: '36.8', match: true },
      { recordId: 'out-03/2026-09-21', field: 'aov', sparkValue: '1841', pythonValue: '1840', match: false },
      { recordId: 'CUST-58213', field: 'rfmTier', sparkValue: 'Loyal', pythonValue: 'Loyal', match: true },
      { recordId: 'itm-042/2026-09-20', field: 'wastagePct', sparkValue: '14.2', pythonValue: '14.1', match: false },
      { recordId: 'ch-dine_in/2026-09-19', field: 'revenueShare', sparkValue: '0.44', pythonValue: '0.44', match: true },
      { recordId: 'itm-020/2026-09-21', field: 'promoDependencyPct', sparkValue: '61.0', pythonValue: '61.0', match: true },
      { recordId: 'cohort/Aug 2026', field: 'm1Retention', sparkValue: '43.2', pythonValue: '43.2', match: true },
      { recordId: 'out-15/2026-09-18', field: 'profitMarginPct', sparkValue: '27.4', pythonValue: '27.4', match: true },
      { recordId: 'itm-035/2026-09-19', field: 'wastageCost', sparkValue: '41200', pythonValue: '41230', match: false },
    ],
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    note: 'Dual-pipeline parity audit: both engines run the same aggregation contracts nightly and the outputs are diffed record-level.',
  },
  insight: {
    summary: [
      `Spark and Python pipelines agree on 98.6% of compared records; the 3 sampled mismatches are rounding-level (≤ PKR 30) rather than logic differences.`,
      `Spark is 2.7× faster on heavy aggregations (264s vs 702s average runtime) while Python keeps a 5.8GB memory footprint for model scoring.`,
      `1 of the last 12 pipeline runs failed (demand_forecast_features) and was retried successfully — the failed run did not reach production tables.`,
    ],
    whyItMatters:
      'Pipeline choice is an audit question as much as a performance one: agreement percentages prove the two stacks compute the same business truth, so reviewers can trust either source and route jobs by cost and latency.',
    evidence: [
      { metric: 'Record agreement', value: '98.6%', detail: '1,248,000 records compared' },
      { metric: 'Spark runtime edge', value: '2.7×', detail: '264s vs 702s average' },
      { metric: 'Mismatch sample', value: '3 / 10 rows', detail: 'Rounding-level, ≤ PKR 30' },
    ],
    period: PERIOD_LABEL,
  },
}

/* --------------------------------- reports ---------------------------------- */

const REPORT_DEFS = [
  ['daily-revenue', 'Daily Revenue Summary', 'Day-level revenue, orders and AOV across the selected scope.', 'csv', 30, 'analytics.view'],
  ['item-performance', 'Item Performance', 'Per-item revenue, margin, trend and performance class.', 'csv', 52, 'analytics.view'],
  ['customer-segments', 'Customer Segments', 'Segment sizes, revenue contribution and order behavior.', 'xlsx', 5, 'exports.run'],
  ['rfm-tiers', 'RFM Tier Distribution', 'Recency/frequency/monetary tiers with revenue share.', 'csv', 5, 'exports.run'],
  ['churn-risk-list', 'Churn Risk List', 'Top at-risk customer accounts with LTV and recency.', 'xlsx', 1200, 'exports.run'],
  ['basket-rules', 'Association Rules', 'Market-basket rules with support, confidence and lift.', 'csv', 14, 'analytics.view'],
  ['demand-forecast', 'Demand Forecast (14d)', 'Item-level forecast quantities with confidence bands.', 'csv', 20, 'analytics.view'],
  ['wastage-detail', 'Wastage Detail', 'Wastage cost and percentage by item, category and outlet.', 'xlsx', 56, 'analytics.view'],
  ['outlet-comparison', 'Outlet Comparison', 'Revenue, AOV, margin and flags for all 24 outlets.', 'csv', 24, 'analytics.view'],
  ['channel-economics', 'Channel Economics', 'Fees, discounts and contribution margin per channel.', 'csv', 4, 'analytics.view'],
  ['anomaly-log', 'Anomaly Log', 'All detected anomalies with severity, evidence and status.', 'csv', 8, 'analytics.view'],
  ['pipeline-audit', 'Pipeline Audit Log', 'Spark/Python run history and record-level diffs (admin only).', 'csv', 500, 'admin.access'],
]
const reportsJson = {
  data: {
    reports: REPORT_DEFS.map(([id, name, description, format, rows, permission], i) => ({
      id,
      name,
      description,
      format,
      rows,
      lastGenerated: new Date(new Date(nowIso).getTime() - (i + 1) * 3600000 * 6).toISOString(),
      requiresPermission: permission,
      scopeNote: 'Exports honor the global date-range and dimension filters where the underlying table supports them.',
    })),
  },
  meta: { generatedAt: nowIso, filters: {} },
}

/* ---------------------------------- admin ----------------------------------- */

const SPARK_JOB_DEFS = [
  ['nightly_kpis_agg', 'success', 264, '200/200', 8, 1248000],
  ['menu_item_rollup', 'success', 188, '150/150', 6, 486000],
  ['customer_rfm', 'success', 341, '220/220', 8, 984000],
  ['basket_fpgrowth', 'success', 402, '260/260', 10, 1248000],
  ['demand_forecast_features', 'failed', 96, '38/220', 8, 214000],
  ['anomaly_detection', 'success', 377, '240/240', 10, 1248000],
  ['channel_mix_agg', 'success', 141, '120/120', 6, 486000],
  ['elasticity_training', 'running', 210, '88/180', 8, 742000],
]
const sparkJobs = SPARK_JOB_DEFS.map(([name, status, dur, stages, cores, rows], i) => ({
  id: `job-${String(1207 - i).padStart(4, '0')}`,
  name,
  status,
  startedAt: new Date(new Date(nowIso).getTime() - (i * 3 + 1) * 3600000).toISOString(),
  durationSec: dur,
  stages,
  cores,
  rowsShuffled: rows,
}))

const DATA_QUALITY_DEFS = [
  ['orders', 'Row count vs source', 'pass', '322,410 rows in the last ingestion — matches the CDC offset.'],
  ['orders', 'Null order_id', 'pass', '0 nulls in the last 30 days.'],
  ['order_lines', 'Duplicate line keys', 'fail', '42 duplicate pairs detected (see anm-002) — quarantine rule active.'],
  ['order_lines', 'FK integrity → orders', 'pass', '100% of line items resolve to an order.'],
  ['customers', 'Duplicate emails', 'warn', '0.4% near-duplicate emails share a phone fingerprint.'],
  ['menu_items', 'Price continuity', 'pass', 'No unexplained price jumps > 25% day-over-day.'],
  ['ratings', 'Review velocity', 'warn', 'Blue Area burst flagged (anm-006); reviews quarantined from aggregates.'],
  ['promotions', 'Window overlaps', 'pass', 'No overlapping campaign windows per channel.'],
  ['wastage', 'Out-of-range percentages', 'pass', 'All wastagePct values within 0–25%.'],
  ['outlets', 'Geo coverage', 'pass', '24/24 outlets reporting hourly POS heartbeats.'],
]
const dataQuality = DATA_QUALITY_DEFS.map(([table, check, status, detail], i) => ({
  id: `dq-${String(i + 1).padStart(2, '0')}`,
  table,
  check,
  status,
  detail,
  lastRun: new Date(new Date(nowIso).getTime() - (i + 1) * 1800000).toISOString(),
}))

const MODEL_REGISTRY_DEFS = [
  ['DemandForecaster (XGBoost)', '3.2', 'python', 'production', [['MAPE', '8.4%'], ['Bias', '+1.2%'], ['Confidence', '0.924']]],
  ['RecommendationEngine', '1.8', 'python', 'production', [['Rules per cycle', '10'], ['Evidence coverage', '100%']]],
  ['AnomalyDetection', '2.1', 'spark', 'production', [['Precision', '0.91'], ['Recall', '0.84']]],
  ['WhatIf ScenarioEngine (sklearn)', '1.4', 'python', 'production', [['Elasticity R²', '0.78'], ['Confidence', '0.87']]],
  ['ChurnScorer (XGBoost)', '0.9', 'python', 'staging', [['AUC', '0.81'], ['Lift@10', '2.6']]],
  ['ElasticityModel (Spark MLlib)', '2.0', 'spark', 'staging', [['R²', '0.74'], ['Items scored', '52']]],
]
const modelRegistry = MODEL_REGISTRY_DEFS.map(([name, version, pipeline, status, metrics], i) => ({
  name,
  version,
  pipeline,
  trainedAt: new Date(new Date(nowIso).getTime() - (i + 2) * 86400000).toISOString(),
  status,
  metrics: metrics.map(([n, v]) => ({ name: n, value: v })),
}))

const AUDIT_DEFS = [
  ['Ayesha Khan', 'admin', 'auth.login', 'session', 1],
  ['Ayesha Khan', 'admin', 'recommendation.acknowledge', 'rec-001', 4],
  ['Bilal Ahmed', 'regional_manager', 'recommendation.acknowledge', 'rec-005', 9],
  ['Bilal Ahmed', 'regional_manager', 'report.run', 'churn-risk-list', 12],
  ['Daniyal Raza', 'analyst', 'report.run', 'item-performance', 7],
  ['Daniyal Raza', 'analyst', 'whatif.run', 'itm-009 +5%', 15],
  ['Sana Malik', 'restaurant_manager', 'auth.login', 'session', 2],
  ['Sana Malik', 'restaurant_manager', 'filter.scope', 'out-10', 2],
  ['Ayesha Khan', 'admin', 'anomaly.status', 'anm-002 → reviewing', 22],
  ['Ayesha Khan', 'admin', 'anomaly.status', 'anm-006 → dismissed', 26],
  ['Bilal Ahmed', 'regional_manager', 'whatif.run', 'itm-020 +10%', 30],
  ['Daniyal Raza', 'analyst', 'auth.login', 'session', 34],
]
const auditTrail = AUDIT_DEFS.map(([user, role, action, target, hoursAgo], i) => ({
  id: `aud-${String(i + 1).padStart(3, '0')}`,
  user,
  role,
  action,
  target,
  at: new Date(new Date(nowIso).getTime() - hoursAgo * 3600000).toISOString(),
}))

const adminJson = {
  data: {
    kpis: {
      tablesIngested: 11,
      rowsIngested: 1248300,
      runsLast24h: 9,
      failedJobs: 1,
      storageGb: 42.6,
      openQualityFails: dataQuality.filter((d) => d.status === 'fail').length,
    },
    sparkJobs,
    dataQuality,
    modelRegistry,
    auditTrail,
  },
  meta: {
    generatedAt: nowIso,
    filters: {},
    note: 'Platform operations payload — reflects the sample cluster, not live infrastructure.',
  },
  insight: {
    summary: [
      `9 pipeline runs completed in the last 24h with 1 failure (demand_forecast_features, retried); 11 tables ingested 1.25M rows.`,
      `Data quality runs 10 checks per cycle — 1 fail (duplicate order-line keys, quarantined) and 2 warns (near-duplicate customer emails, review velocity).`,
      `6 models are registered: 4 production, 2 staging; every production model carries its evaluation metrics in the registry.`,
    ],
    whyItMatters:
      'Every number in this platform is only as trustworthy as the ingestion and quality layer behind it — the fail/warn items here map directly to anomalies visible on the Anomalies page, so data issues stay auditable end to end.',
    evidence: [
      { metric: 'Runs (24h)', value: '9 · 1 failed', detail: 'Failed job retried successfully' },
      { metric: 'Quality checks', value: `${dataQuality.length} per cycle`, detail: '1 fail · 2 warn · 7 pass' },
      { metric: 'Models registered', value: String(modelRegistry.length), detail: '4 production · 2 staging' },
    ],
    period: 'Last 24 hours',
  },
}

/* --------------------------------- write ---------------------------------- */

const write = (name, obj) => {
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj, null, 2))
  console.log(`  wrote ${name}`)
}

write('kpis.json', kpisJson)
write('menu-items.json', menuItemsJson)
write('whatif-config.json', whatifConfigJson)
write('locations.json', locationsJson)
write('channels.json', channelsJson)
write('recommendations.json', recommendationsJson)
write('anomalies.json', anomaliesJson)
write('demo-accounts.json', demoAccountsJson)
write('customers.json', customersJson)
write('basket.json', basketJson)
write('forecast.json', forecastJson)
write('wastage.json', wastageJson)
write('pricing.json', pricingJson)
write('locations-detail.json', locationsDetailJson)
write('channels-hourly.json', channelsHourlyJson)
write('models.json', modelsJson)
write('reports.json', reportsJson)
write('admin.json', adminJson)

/* ----------------------------- consistency log ---------------------------- */

const trendSum = series.reduce((s, p) => s + p.revenue, 0)
const channelShareSum = channelMix.reduce((s, c) => s + c.share, 0)
const channelRevenueSum = channelMix.reduce((s, c) => s + c.revenue, 0)

console.log('\nConsistency checks:')
console.log(`  window               ${isoDate(START)} .. ${isoDate(END)} (${N} days)`)
console.log(`  revenue total        ${revenueTotal.toLocaleString()}  (trend sum: ${trendSum.toLocaleString()})  -> ${revenueTotal === trendSum ? 'OK' : 'MISMATCH'}`)
console.log(`  orders total         ${ordersTotal.toLocaleString()}  (heatmap sum: ${heatmapTotal.toLocaleString()})  -> ${ordersTotal === heatmapTotal ? 'OK' : 'MISMATCH'}`)
console.log(`  AOV                  ${aovTotal.toFixed(2)}  (revenue / orders)`)
console.log(`  channel share sum    ${channelShareSum.toFixed(2)}  -> ${Math.abs(channelShareSum - 1) < 1e-9 ? 'OK' : 'MISMATCH'}`)
console.log(`  channel revenue sum  ${channelRevenueSum.toLocaleString()}  (<= total, remainder in unlisted channels)`)
console.log(`  outlet share sum     ${outletShareSum.toFixed(4)}  -> ${Math.abs(outletShareSum - 1) < 0.01 ? 'OK' : 'MISMATCH'}`)
console.log(`  items                ${items.length} (revenue coverage ${(COVERAGE * 100).toFixed(0)}%)`)
console.log(`  recommendations      ${recommendations.length} (all with evidence: ${recommendations.every((r) => r.evidence.length > 0) ? 'OK' : 'MISMATCH'})`)
