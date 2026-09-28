import * as React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ErrorBoundary } from '@/components/errors/ErrorBoundary'
import { findNavItem } from '@/routes/navigation'
import { useAuth } from '@/features/auth/AuthProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DineIQAssistant } from '@/features/assistant/DineIQAssistant'

/**
 * AppShell — the persistent application frame (spec §12):
 * desktop sidebar (collapsible) · mobile drawer · top bar · command palette
 * (Ctrl/⌘+K) · route transition layer.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem('dineiq.sidebar.collapsed') === '1'
    } catch {
      return false
    }
  })
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const location = useLocation()
  const { hasPermission } = useAuth()

  // Global keyboard shortcut: Ctrl/⌘ + K.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navItem = findNavItem(location.pathname)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
        </aside>

        {/* Mobile drawer — controlled; opened from the top bar menu button */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="p-0">
            <Sidebar collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            title={navItem?.label ?? 'DineIQ Analytics'}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <main id="main" className="flex-1 overflow-y-auto" tabIndex={-1}>
            <ErrorBoundary>
              <RouteTransition>
                <Outlet />
              </RouteTransition>
            </ErrorBoundary>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <DineIQAssistant />
      </div>
    </TooltipProvider>
  )
}

/** Subtle page transition — communicates hierarchy without theatrics (§11). */
function RouteTransition({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion()
  const location = useLocation()
  if (reduced) return <div className="p-4 sm:p-6">{children}</div>
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="p-4 sm:p-6"
    >
      {children}
    </motion.div>
  )
}
