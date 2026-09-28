import { ArrowLeft, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/errors/states'
import type { NavItem } from '@/routes/navigation'

/**
 * ModulePlaceholder — honest phase roadmap state for modules scheduled in
 * later build phases (spec §54). Displays the module's planned scope from
 * the navigation registry and explicitly states that no sample analytics
 * are shown. No placeholder charts, no invented data.
 */
export function ModulePlaceholder({ item }: { item: NavItem }) {
  return (
    <div className="mx-auto max-w-2xl pt-10">
      <div className="glass-card relative overflow-hidden p-8">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-primary-strong opacity-70"
        />
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-strong">
            <item.icon className="h-6 w-6 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-tight text-foreground">{item.label}</h2>
              <Badge variant="primary">
                <CalendarClock className="h-3 w-3" aria-hidden /> Planned for Phase {item.phase}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
            <p className="mt-3 rounded-lg border border-dashed border-border bg-surface-strong p-3 text-xs leading-relaxed text-subtle">
              This module is scheduled for Phase {item.phase} of the competition build. The typed
              API contracts and mock datasets for it already exist — the interface will activate
              against the same integrity rules as the Executive Dashboard. No sample analytics are
              rendered here to avoid implying data that the backend does not yet expose through
              this module's pages.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <Button variant="outline" size="sm" asChild>
          <a href="/dashboard">
            <ArrowLeft aria-hidden /> Return to Executive Dashboard
          </a>
        </Button>
      </div>
    </div>
  )
}

/**
 * NotFoundPage — 404 state for unknown routes.
 */
export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl pt-16">
      <ErrorState
        title="Page not found"
        description="The requested view does not exist in the DineIQ command centre. Use the sidebar or the command palette (Ctrl+K) to navigate."
      />
    </div>
  )
}
