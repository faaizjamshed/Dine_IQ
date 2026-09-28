/**
 * Shared number/date formatters — the single source of truth for how values
 * appear across the application (spec §17).
 *
 * Components MUST use these helpers instead of formatting values locally.
 * Compact scale follows the spec examples: PKR 1.2M, 320K orders, 18.4%.
 */

const MAX_COMPACT = 1e12

function compact(n: number): { value: string; suffix: string } {
  const abs = Math.abs(n)
  if (abs >= 1e9) return { value: trim(n / 1e9), suffix: 'B' }
  if (abs >= 1e6) return { value: trim(n / 1e6), suffix: 'M' }
  if (abs >= 1e3) return { value: trim(n / 1e3), suffix: 'K' }
  return { value: String(Math.round(n)), suffix: '' }
}

function trim(n: number): string {
  const rounded = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10
  return String(rounded)
}

/** PKR 48.6M / PKR 1,836 */
export function formatPKR(value: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(value)) return '—'
  if (opts?.compact && Math.abs(value) >= 1e5 && Math.abs(value) <= MAX_COMPACT) {
    const { value: v, suffix } = compact(value)
    return `PKR ${v}${suffix}`
  }
  return `PKR ${Math.round(value).toLocaleString('en-US')}`
}

/** 26.5K / 1.2M — plain compact number, no unit prefix */
export function formatNumberCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const { value: v, suffix } = compact(value)
  return `${v}${suffix}`
}

/** 26,480 — full grouped integer */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

/** 8.4 → "8.4%" */
export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Signed delta: 8.4 → "+8.4%", -3.2 → "-3.2%" */
export function formatDelta(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/** 4.6 → "4.6 / 5" */
export function formatRating(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} / 5`
}

/** Compact axis value: 1600000 → "1.6M" */
export function formatAxisCompact(value: number): string {
  if (!Number.isFinite(value)) return ''
  const { value: v, suffix } = compact(value)
  return `${v}${suffix}`
}

/** ISO date → "Sep 23" */
export function formatDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** ISO date → "Sep 23, 2026" */
export function formatDate(iso: string): string {
  if (!iso) return 'Unavailable'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** ISO datetime → "Sep 23, 2026 14:05" */
export function formatDateTime(iso: string): string {
  if (!iso) return 'Unavailable'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Relative time against now: "2h ago", "3d ago" */
export function formatRelative(iso: string): string {
  if (!iso) return 'Time unavailable'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/** Title-cases a snake_case identifier: "sales_spike" → "Sales Spike" */
export function humanize(identifier: string): string {
  return identifier
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Unknown values are never displayed as zero. */
export function formatDecimal(value: number, digits = 1): string { return Number.isFinite(value) ? value.toFixed(digits) : '—' }
