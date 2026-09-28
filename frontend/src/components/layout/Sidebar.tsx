import * as React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { DineIQMark } from '@/features/auth/DineIQMark'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { visibleNavGroups } from '@/routes/navigation'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'

const SIDEBAR_KEY = 'dineiq.sidebar.collapsed'

/**
 * Sidebar — persistent command-centre navigation (spec §12).
 *
 * Desktop: collapsible with icon-only mode + tooltips when collapsed.
 * Mobile: rendered inside a Sheet drawer (see AppShell).
 * Items the current role lacks permission for are hidden entirely.
 */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  className,
}: {
  collapsed: boolean
  onToggleCollapsed?: () => void
  /** Called after a link is activated — used by the mobile drawer to close. */
  onNavigate?: () => void
  className?: string
}) {
  const { hasPermission } = useAuth()
  const location = useLocation()
  const groups = visibleNavGroups(hasPermission)

  // Persist the collapsed preference.
  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex h-full flex-col border-r border-border bg-background-subtle/80 backdrop-blur-md transition-[width] duration-200',
        collapsed ? 'w-[76px]' : 'w-[264px]',
        className,
      )}
    >
      {/* Brand */}
      <div className={cn('flex items-center gap-2.5 px-4 py-4', collapsed && 'justify-center px-2')}>
        <DineIQMark size={34} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-tight text-foreground">DineIQ</p>
            <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-subtle">
              Analytics Platform
            </p>
          </div>
        )}
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="overline-label px-2 pb-1.5 text-subtle">{group.label}</p>
            )}
            {collapsed && <div className="mx-2 mb-2 h-px bg-border" />}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                // Phase chip only for modules whose real page hasn't shipped yet.
                const phaseTag = !item.live && item.phase > 1 ? `P${item.phase}` : null
                const link = (
                  <NavLink
                    to={item.path}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium transition-colors',
                        collapsed && 'justify-center px-0',
                        isActive
                          ? 'bg-primary/12 text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-gradient-to-b before:from-primary before:to-primary-strong'
                          : 'text-muted hover:bg-surface-strong hover:text-foreground',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && phaseTag && (
                      <span className="ml-auto shrink-0 rounded bg-surface-strong px-1 py-px font-mono text-[8px] text-subtle">
                        {phaseTag}
                      </span>
                    )}
                  </NavLink>
                )

                return (
                  <li key={item.path}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                          {item.label}
                          {phaseTag && <span className="ml-1 text-subtle">· Phase {item.phase}</span>}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Collapse toggle */}
      {onToggleCollapsed && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-strong hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <ChevronLeft
              className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
              aria-hidden
            />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      )}
    </nav>
  )
}
