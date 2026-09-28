import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Moon, Search, Sun, Bell, Menu, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SampleDataBadge } from './SampleDataBadge'
import { ApiStatus } from './ApiStatus'
import { useTheme } from './theme'
import { FilterBar } from '@/components/filters/FilterBar'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/lib/permissions'
import { fetchAnomalies } from '@/api/endpoints'
import { getToken } from '@/api/client'
import { AnomalyCard } from '@/components/insights'
import { formatRelative } from '@/lib/formatters'
import type { Anomaly } from '@/api/types'

/**
 * TopBar — global command surface (spec §13): filters, command palette
 * trigger (Ctrl/⌘+K), notification bell, sample-data badge, API status,
 * theme toggle and the role-aware user menu.
 */
export function TopBar({
  title,
  onOpenMobileNav,
  onOpenPalette,
}: {
  title: string
  onOpenMobileNav: () => void
  onOpenPalette: () => void
}) {
  const { user, logout, useMocks } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </Button>

      <h1 className="truncate text-sm font-bold tracking-tight text-foreground">{title}</h1>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <FilterBar layout="inline" />
        <div className="xl:hidden">
          <FilterBar layout="sheet" />
        </div>

        <SampleDataBadge />
        <div className="hidden sm:flex items-center gap-1.5">
          <ApiStatus />
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="hidden h-8 gap-2 font-mono text-[11px] text-muted md:flex"
          onClick={onOpenPalette}
          aria-label="Open command palette (Control K)"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          Search
          <kbd className="rounded border border-border bg-surface-strong px-1 py-px text-[9px]">
            ⌘K
          </kbd>
        </Button>

        <NotificationBell />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          onClick={onOpenPalette}
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4" aria-hidden />
        </Button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              aria-label="Open user menu"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-strong text-xs font-extrabold text-primary-foreground">
                {initials(user?.name)}
              </span>
              <span className="hidden min-w-0 max-w-28 text-left 2xl:block">
                <span className="block truncate text-xs font-bold text-foreground">
                  {user?.name ?? 'User'}
                </span>
                <span className="block truncate text-[10px] text-muted">
                  {user ? ROLE_LABELS[user.role] : ''}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="block truncate text-foreground">{user?.email}</span>
              <span className="font-mono text-[10px] font-normal text-subtle">
                Role: {user ? ROLE_LABELS[user.role] : ''} · {useMocks ? 'sample-data session' : 'live session'}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/dashboard')}>
              <UserRound aria-hidden /> Account overview
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout()
              }}
              className="text-negative focus:text-negative"
            >
              <LogOut aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function initials(name?: string): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </Button>
  )
}

/**
 * NotificationBell — operational feed of critical anomalies. Data comes from
 * GET /api/intelligence/anomalies (severity-filtered) fetched on open; the component
 * invents no notification content.
 */
function NotificationBell() {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<Anomaly[] | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void fetchAnomalies({ limit: 5 }, authHeaders())
      .then((res) => {
        if (!cancelled) setItems(res.data.anomalies)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const criticalCount = items?.filter((a) => a.severity === 'critical').length ?? 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="h-4 w-4" aria-hidden />
          {criticalCount > 0 && (
            <span
              aria-hidden
              className="priority-critical-dot absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-critical"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border p-3">
          <p className="text-xs font-bold text-foreground">Latest anomaly detections</p>
          <span className="font-mono text-[10px] text-subtle">GET /api/intelligence/anomalies</span>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <p className="p-4 text-center text-xs text-muted">Loading detections…</p>}
          {!loading && items && items.length === 0 && (
            <p className="p-4 text-center text-xs text-muted">
              No anomalies detected in the current period.
            </p>
          )}
          {!loading &&
            items?.map((a) => (
              <div key={a.id} className="mb-1 rounded-lg p-0.5">
                <AnomalyCard anomaly={a} compact />
                <p className="px-1 pb-1 font-mono text-[9px] text-subtle">
                  Detected {formatRelative(a.detectedAt)}
                </p>
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
