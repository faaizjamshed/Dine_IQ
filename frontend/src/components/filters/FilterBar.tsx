import { SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet'
import { DateRangeFilter } from './DateRangeFilter'
import { FilterSelect, useFilterData } from './FilterSelect'
import { useFilters } from '@/hooks/useFilters'
import type { GlobalFilters } from '@/api/types'

/**
 * FilterBar — global filter system, URL-persisted (spec §14).
 *
 * Desktop: inline in the top bar. Mobile: collapsed into a sheet trigger
 * with an active-filter count badge (spec §44). Changing any filter updates
 * the URL; query keys embed the filter object so affected data refetches
 * automatically and page insight strips stay in sync.
 */
export function FilterBar({ layout = 'inline' }: { layout?: 'inline' | 'sheet' }) {
  const { filters, setFilters, setFilter, resetFilters, activeCount } = useFilters()
  const { locations, categories, channels } = useFilterData()

  if (layout === 'sheet') {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5" aria-label="Open filters">
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" aria-hidden />
            Filters
            {activeCount > 0 && (
              <span className="ml-0.5 rounded bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80">
          <div className="flex flex-col gap-4 pt-2">
            <p className="overline-label text-subtle">Global filters</p>
            <FilterFields
              filters={filters}
              setFilters={setFilters}
              setFilter={setFilter}
              locations={locations}
              categories={categories}
              channels={channels}
            />
            <SheetClose asChild>
              <Button variant="ghost" size="sm" onClick={resetFilters} className="justify-start">
                <X aria-hidden /> Reset all filters
              </Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="hidden items-center gap-1.5 xl:flex">
      <DateRangeFilter filters={filters} onChange={setFilters} />
      <FilterSelect
        label="Outlets"
        value={filters.location}
        options={locations}
        onChange={(v) => setFilter('location', v)}
        className="w-44"
      />
      <FilterSelect
        label="Categories"
        value={filters.category}
        options={categories}
        onChange={(v) => setFilter('category', v)}
      />
      <FilterSelect
        label="Channels"
        value={filters.channel}
        options={channels}
        onChange={(v) => setFilter('channel', v)}
      />
      {(activeCount > 0 || filters.dateFrom) && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={resetFilters}
          aria-label="Reset all filters"
          title="Reset all filters"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
    </div>
  )
}

function FilterFields({
  filters,
  setFilters,
  setFilter,
  locations,
  categories,
  channels,
}: {
  filters: GlobalFilters
  setFilters: (patch: Partial<GlobalFilters>) => void
  setFilter: (key: 'location' | 'category' | 'channel', value: string | undefined) => void
  locations: { value: string; label: string }[]
  categories: { value: string; label: string }[]
  channels: { value: string; label: string }[]
}) {
  return (
    <>
      <DateRangeFilter filters={filters} onChange={setFilters} />
      <FilterSelect
        label="Outlets"
        value={filters.location}
        options={locations}
        onChange={(v) => setFilter('location', v)}
        className="w-full"
      />
      <FilterSelect
        label="Categories"
        value={filters.category}
        options={categories}
        onChange={(v) => setFilter('category', v)}
        className="w-full"
      />
      <FilterSelect
        label="Channels"
        value={filters.channel}
        options={channels}
        onChange={(v) => setFilter('channel', v)}
        className="w-full"
      />
    </>
  )
}
