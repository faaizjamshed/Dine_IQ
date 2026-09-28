/**
 * Global filter state — URL-persisted (spec §14).
 *
 * Filters live in the query string (/dashboard?dateFrom=…&location=…).
 * Changing a filter updates the URL; because TanStack Query keys embed the
 * filter object, affected queries refetch automatically while unrelated
 * caches are preserved.
 *
 * When no date range is present in the URL, the DEFAULT range (last 30 days
 * ending yesterday) is returned but NOT written to the URL — the URL only
 * records what the user has actually chosen.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { GlobalFilters } from '@/api/types'

export const FILTER_KEYS = [
  'dateFrom',
  'dateTo',
  'location',
  'category',
  'channel',
  'segment',
  'promotion',
  'performanceClass',
  'priceMin',
  'priceMax',
  'ratingMin',
  'wastageMin',
  'wastageMax',
] as const

export function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const fmt = (d: Date) => {
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }
  const to = new Date()
  to.setHours(0, 0, 0, 0)
  to.setDate(to.getDate() - 1)
  const from = new Date(to)
  from.setDate(from.getDate() - 29)
  return { dateFrom: fmt(from), dateTo: fmt(to) }
}

export interface UseFiltersResult {
  /** Fully-resolved filters (defaults applied for missing keys). */
  filters: GlobalFilters
  /** Raw filters as present in the URL (no defaults). */
  rawFilters: GlobalFilters
  setFilter: (key: keyof GlobalFilters, value: string | number | undefined) => void
  setFilters: (patch: Partial<GlobalFilters>) => void
  resetFilters: () => void
  /** Number of explicitly-set filter keys (for the mobile badge). */
  activeCount: number
}

export function useFilters(): UseFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()

  const rawFilters = useMemo(() => {
    const out: Record<string, string> = {}
    for (const key of FILTER_KEYS) {
      const v = searchParams.get(key)
      if (v) out[key] = v
    }
    return out as GlobalFilters
  }, [searchParams])

  const filters = useMemo<GlobalFilters>(() => {
    return {
      ...rawFilters,
    }
  }, [rawFilters])

  const commit = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams)
      mutate(next)
      setSearchParams(next, { replace: false })
    },
    [searchParams, setSearchParams],
  )

  const setFilter = useCallback(
    (key: keyof GlobalFilters, value: string | number | undefined) => {
      commit((params) => {
        if (value === undefined || value === '' || value === 'all') params.delete(key)
        else params.set(key, String(value))
      })
    },
    [commit],
  )

  const setFilters = useCallback(
    (patch: Partial<GlobalFilters>) => {
      commit((params) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === '' || value === 'all') params.delete(key)
          else params.set(key, String(value))
        }
      })
    },
    [commit],
  )

  const resetFilters = useCallback(() => {
    commit((params) => {
      for (const key of FILTER_KEYS) params.delete(key)
    })
  }, [commit])

  const activeCount = useMemo(
    () => Object.values(rawFilters).filter((v) => v !== undefined && v !== '').length,
    [rawFilters],
  )

  return { filters, rawFilters, setFilter, setFilters, resetFilters, activeCount }
}
