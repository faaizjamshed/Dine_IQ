import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { formatDate, formatDateShort } from '@/lib/formatters'
import { USE_MOCKS } from '@/api/client'
import type { GlobalFilters } from '@/api/types'
import { defaultDateRange } from '@/hooks/useFilters'

/**
 * DateRangeFilter — preset ranges + custom dates (spec §14).
 *
 * In mock mode the sample coverage is the 30-day canonical window; ranges
 * that miss it return a structured "no data" response from the adapter and
 * the page shows its empty state (demonstrated honestly, not hidden).
 */
export function DateRangeFilter({
  filters,
  onChange,
}: {
  filters: GlobalFilters
  onChange: (patch: Partial<GlobalFilters>) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [from, setFrom] = React.useState(filters.dateFrom ?? '')
  const [to, setTo] = React.useState(filters.dateTo ?? '')

  React.useEffect(() => {
    setFrom(filters.dateFrom ?? '')
    setTo(filters.dateTo ?? '')
  }, [filters.dateFrom, filters.dateTo])

  const today = new Date()
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const presets = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 14 days', days: 14 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
  ]

  const applyPreset = (days: number) => {
    const start = new Date(yesterday)
    start.setDate(start.getDate() - (days - 1))
    onChange({ dateFrom: fmt(start), dateTo: fmt(yesterday) })
    setOpen(false)
  }

  const applyCustom = () => {
    if (!from || !to || from > to) return
    onChange({ dateFrom: from, dateTo: to })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 max-w-56 gap-1.5 font-mono text-[11px]"
          aria-label={`Date range: ${filters.dateFrom ?? ''} to ${filters.dateTo ?? ''}`}
        >
          <CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="truncate">
            {filters.dateFrom ? formatDateShort(filters.dateFrom) : 'Full history'}{filters.dateTo ? ' – ' : ''}
            {filters.dateTo ? formatDate(filters.dateTo) : ''}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Date filtering is available for monthly demand, monthly wastage and returned anomaly events. Other analyses require full history.</p>
          <Button size="sm" variant="outline" onClick={() => { onChange({ dateFrom: undefined, dateTo: undefined }); setOpen(false) }}>Full history</Button>
          <p className="overline-label text-subtle">Presets</p>
          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset(p.days)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="date-from">From</Label>
              <Input
                id="date-from"
                type="date"
                value={from}
                max={to || fmt(yesterday)}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="date-to">To</Label>
              <Input
                id="date-to"
                type="date"
                value={to}
                min={from}
                max={fmt(yesterday)}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Button size="sm" onClick={applyCustom} disabled={!from || !to || from > to}>
            Apply custom range
          </Button>
          {USE_MOCKS && (
            <p className="font-mono text-[10px] leading-relaxed text-subtle">
              Sample data covers a 30-day window ending yesterday. Ranges outside it will show an
              empty state.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { defaultDateRange }
