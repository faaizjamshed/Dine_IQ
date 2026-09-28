import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchFilters, fetchMenuItems } from '@/api/endpoints'
import { str } from '@/api/backend'
import { getToken } from '@/api/client'
import { STALE_TIME } from '@/api/queryKeys'
import type { GlobalFilters } from '@/api/types'

/**
 * FilterSelect — generic URL-backed single-select filter with an "all" option.
 * Option lists are API-derived (outlets from /api/restaurants,
 * categories from /api/intelligence/menu, channels from /api/channels);
 * the frontend never hardcodes business vocabularies.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: string | undefined
  /** Empty string value = "all". */
  options: { value: string; label: string }[]
  onChange: (value: string | undefined) => void
  className?: string
}) {
  return (
    <Select
      value={value ?? 'all'}
      onValueChange={(v) => onChange(v === 'all' ? undefined : v)}
    >
      <SelectTrigger aria-label={label} className={className ?? 'w-36'}>
        <span className="sr-only">{label}: </span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ---------------------- API-derived option collections --------------------- */

const auth = () => ({ Authorization: getToken() ? `Bearer ${getToken()}` : '' })

export function useLocationOptions(): { value: string; label: string }[] {
  const { data } = useQuery({
    queryKey: ['reference', 'filters'],
    queryFn: fetchFilters,
    staleTime: STALE_TIME.reference,
  })
  return (
    data?.restaurants.map((o) => ({ value: str(o, 'restaurant_id'), label: `${str(o, 'restaurant_name')} · ${str(o, 'city')}` })) ?? []
  )
}

export function useCategoryOptions(): { value: string; label: string }[] {
  const { data } = useQuery({
    queryKey: ['reference', 'menu-categories'],
    queryFn: () => fetchMenuItems({}, auth()),
    staleTime: STALE_TIME.reference,
  })
  const seen = new Map<string, string>()
  for (const item of data?.data.items ?? []) {
    if (item.categoryId && !seen.has(item.categoryId)) seen.set(item.categoryId, item.category)
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }))
}

export function useChannelOptions(): { value: string; label: string }[] {
  const { data } = useQuery({
    queryKey: ['reference', 'filters'],
    queryFn: fetchFilters,
    staleTime: STALE_TIME.reference,
  })
  return data?.channels.map((c) => ({ value: c, label: c })) ?? []
}

/** Convenience aggregate used by both the desktop bar and the mobile sheet. */
export function useFilterData() {
  return {
    locations: useLocationOptions(),
    categories: useCategoryOptions(),
    channels: useChannelOptions(),
  }
}

export type { GlobalFilters }
