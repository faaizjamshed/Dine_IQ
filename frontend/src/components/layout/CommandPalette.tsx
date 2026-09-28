import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, Moon, Sun, LayoutDashboard } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { fetchMenuItems, fetchLocations } from '@/api/endpoints'
import { getToken } from '@/api/client'
import { STALE_TIME } from '@/api/queryKeys'
import { ALL_NAV_ITEMS } from '@/routes/navigation'
import { useAuth } from '@/features/auth/AuthProvider'
import { useTheme } from './theme'
import { cn } from '@/lib/utils'

interface PaletteEntry {
  id: string
  group: 'Pages' | 'Menu items' | 'Outlets' | 'Actions'
  label: string
  hint?: string
  keywords: string
  perform: () => void
}

/**
 * CommandPalette — Ctrl/⌘+K quick navigation (spec §13).
 *
 * Foundation scope: pages (registry), menu items and outlets (fetched from
 * the API when the palette opens), plus theme actions. Fully keyboard
 * driven: ↑/↓ to move, Enter to run, Esc to close.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)

  // Fetch searchable collections lazily — only when the palette opens (§46).
  const auth = React.useMemo(
    () => ({ Authorization: getToken() ? `Bearer ${getToken()}` : '' }),
    [],
  )
  const { data: menuData } = useQuery({
    queryKey: ['palette', 'menu-items'],
    queryFn: () => fetchMenuItems({}, auth),
    enabled: open,
    staleTime: STALE_TIME.reference,
  })
  const { data: locData } = useQuery({
    queryKey: ['palette', 'outlets'],
    queryFn: () => fetchLocations({}, auth),
    enabled: open,
    staleTime: STALE_TIME.reference,
  })

  const entries = React.useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = []

    for (const item of ALL_NAV_ITEMS) {
      if (!hasPermission(item.permission)) continue
      list.push({
        id: `page-${item.path}`,
        group: 'Pages',
        label: item.label,
        hint: !item.live && item.phase > 1 ? `Phase ${item.phase} module` : undefined,
        keywords: `${item.path} ${item.description}`,
        perform: () => navigate(item.path),
      })
    }

    for (const item of menuData?.data.items.slice(0, 60) ?? []) {
      list.push({
        id: `item-${item.itemId}`,
        group: 'Menu items',
        label: item.name,
        hint: item.category,
        keywords: `${item.itemId} ${item.category} ${item.performanceClass}`,
        perform: () => navigate('/menu'),
      })
    }

    for (const outlet of locData?.data.outlets ?? []) {
      list.push({
        id: `outlet-${outlet.id}`,
        group: 'Outlets',
        label: outlet.name,
        hint: outlet.city,
        keywords: `${outlet.id} ${outlet.city} outlet`,
        perform: () => navigate('/locations'),
      })
    }

    list.push({
      id: 'action-theme',
      group: 'Actions',
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      keywords: 'theme dark light mode toggle appearance',
      perform: toggleTheme,
    })

    return list
  }, [menuData, locData, navigate, hasPermission, theme, toggleTheme])

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // Default view: pages + actions first.
      return entries.filter((e) => e.group === 'Pages' || e.group === 'Actions').slice(0, 10)
    }
    return entries
      .filter((e) => `${e.label} ${e.keywords}`.toLowerCase().includes(q))
      .slice(0, 12)
  }, [entries, query])

  React.useEffect(() => {
    setActive(0)
  }, [query, open])

  React.useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const runEntry = (entry?: PaletteEntry) => {
    if (!entry) return
    onOpenChange(false)
    entry.perform()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runEntry(results[active])
    }
  }

  let lastGroup = ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="top-[18%] max-w-xl translate-y-0 gap-0 p-0"
        onKeyDown={onKeyDown}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, menu items, outlets…"
            aria-label="Search"
            className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
          />
          <kbd className="rounded border border-border bg-surface-strong px-1.5 py-0.5 font-mono text-[9px] text-subtle">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {results.length === 0 && (
            <p className="p-6 text-center text-xs text-muted">
              No matches for “{query}”. Try a page, dish or outlet name.
            </p>
          )}
          {results.map((entry, idx) => {
            const showGroup = entry.group !== lastGroup
            lastGroup = entry.group
            return (
              <React.Fragment key={entry.id}>
                {showGroup && (
                  <p className="overline-label px-2 pb-1 pt-2 text-subtle">{entry.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => runEntry(entry)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    idx === active ? 'bg-primary/15 text-foreground' : 'text-muted',
                  )}
                >
                  {entry.group === 'Pages' ? (
                    <LayoutDashboard className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  ) : entry.group === 'Actions' ? (
                    theme === 'dark' ? (
                      <Sun className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <Moon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    )
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
                  )}
                  <span className="truncate font-medium text-foreground">{entry.label}</span>
                  {entry.hint && <span className="truncate text-xs text-subtle">· {entry.hint}</span>}
                  {idx === active && (
                    <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  )}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 font-mono text-[9px] text-subtle">
          <span>↑↓ navigate</span>
          <span>⏎ select</span>
          <span>esc close</span>
          <span className="ml-auto">DineIQ command palette</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
