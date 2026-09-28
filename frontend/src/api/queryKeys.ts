/**
 * TanStack Query key factory (spec §19).
 *
 * Keys embed the full filter object so any URL filter change produces a new
 * cache entry and an automatic refetch — while unrelated queries keep their
 * own cache. Sensible per-endpoint staleTime is co-located here.
 */

import type { GlobalFilters } from './types'

export const queryKeys = {
  kpis: (filters: GlobalFilters) => ['kpis', filters] as const,
  menuItems: (filters: GlobalFilters) => ['menu', 'items', filters] as const,
  menuSummary: (filters: GlobalFilters) => ['menu', 'summary', filters] as const,
  locations: (filters: GlobalFilters) => ['locations', 'compare', filters] as const,
  locationsDetail: (filters: GlobalFilters) => ['locations', 'detail', filters] as const,
  channels: (filters: GlobalFilters) => ['channels', 'compare', filters] as const,
  channelsHourly: (filters: GlobalFilters) => ['channels', 'hourly', filters] as const,
  recommendations: (filters: GlobalFilters & { priority?: string; status?: string }) =>
    ['recommendations', filters] as const,
  anomalies: (filters: GlobalFilters & { limit?: number }) => ['anomalies', filters] as const,
  /* Phase 3 */
  customers: (filters: GlobalFilters) => ['customers', 'overview', filters] as const,
  basket: (filters: GlobalFilters) => ['basket', 'analysis', filters] as const,
  forecast: (filters: GlobalFilters) => ['forecast', 'overview', filters] as const,
  wastage: (filters: GlobalFilters) => ['wastage', 'overview', filters] as const,
  /* Phase 4 */
  pricing: (filters: GlobalFilters) => ['pricing', 'overview', filters] as const,
  /* Phase 5 */
  pipelines: () => ['pipelines', 'compare'] as const,
  reports: () => ['reports', 'catalog'] as const,
  admin: () => ['admin', 'overview'] as const,
}

/**
 * Cache freshness by endpoint volatility. Mock mode adds latency so these
 * behaviors are visible during review.
 */
export const STALE_TIME = {
  /** Executive aggregates — moderately stable. */
  kpis: 2 * 60 * 1000,
  /** Reference lists used for filters/search — long-lived. */
  reference: 10 * 60 * 1000,
  /** Operational feeds. */
  feed: 60 * 1000,
} as const
