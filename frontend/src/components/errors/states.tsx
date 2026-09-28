import * as React from 'react'
import {
  Ban,
  AlertTriangle,
  Database,
  KeyRound,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  WifiOff,
  BrainCircuit,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/utils'

/*
 * Error & empty state system (spec §47/§48).
 * Every state explains WHAT happened and WHAT the user can do, offers Retry
 * where appropriate, and never exposes raw stack traces.
 */

export interface ErrorStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  retry?: () => void
  action?: React.ReactNode
  className?: string
}

export function ErrorState({ icon, title, description, retry, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center',
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-strong text-muted">
        {icon ?? <AlertTriangle className="h-5 w-5" aria-hidden />}
      </div>
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted">{description}</p>
      {(retry || action) && (
        <div className="mt-2 flex items-center gap-2">
          {retry && (
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw aria-hidden /> Retry
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  )
}

/** Contextual empty state — messages are supplied by the caller per module. */
export function NoDataState({
  message = 'No data available for the selected filters.',
  hint,
  action,
  className,
}: {
  message?: string
  hint?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <ErrorState
      icon={<Database className="h-5 w-5" aria-hidden />}
      title="Nothing to show yet"
      description={hint ? `${message} ${hint}` : message}
      action={action}
      className={className}
    />
  )
}

export function NetworkErrorState({ retry }: { retry?: () => void }) {
  return (
    <ErrorState
      icon={<WifiOff className="h-5 w-5" aria-hidden />}
      title="Network unavailable"
      description="The application cannot reach the analytics service. Check your connection, then retry."
      retry={retry}
    />
  )
}

export function PipelineUnavailableState({ retry }: { retry?: () => void }) {
  return (
    <ErrorState
      icon={<PlugZap className="h-5 w-5" aria-hidden />}
      title="Analytics pipeline unavailable"
      description="The data pipeline (Spark / Python services) is not responding. Aggregates will return automatically once it recovers."
      retry={retry}
    />
  )
}

export function ModelUnavailableState({ retry }: { retry?: () => void }) {
  return (
    <ErrorState
      icon={<BrainCircuit className="h-5 w-5" aria-hidden />}
      title="Model output unavailable"
      description="The model service did not return a prediction. No substitute values are shown — retry to request fresh output."
      retry={retry}
    />
  )
}

export function PermissionDeniedState({ role }: { role?: string }) {
  return (
    <ErrorState
      icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
      title="Permission denied"
      description={
        role
          ? `The ${role} role does not have access to this module. Contact an administrator if you believe this is an error.`
          : 'Your role does not have access to this module. Contact an administrator if you believe this is an error.'
      }
    />
  )
}

export function SessionExpiredState() {
  return (
    <ErrorState
      icon={<KeyRound className="h-5 w-5" aria-hidden />}
      title="Session expired"
      description="Your session is no longer valid. Sign in again to continue."
    />
  )
}

/**
 * Maps a normalized ApiError to the correct state component. Unknown kinds
 * fall back to a generic API error — raw details stay out of the UI.
 */
export function ApiErrorState({
  error,
  retry,
  role,
}: {
  error: unknown
  retry?: () => void
  role?: string
}) {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'network':
        return <NetworkErrorState retry={retry} />
      case 'pipeline':
        return <PipelineUnavailableState retry={retry} />
      case 'model':
        return <ModelUnavailableState retry={retry} />
      case 'forbidden':
        return <PermissionDeniedState role={role} />
      case 'auth':
        return <SessionExpiredState />
      case 'no_data':
        return <NoDataState message={error.message} />
      case 'not_found':
        return (
          <ErrorState
            icon={<Ban className="h-5 w-5" aria-hidden />}
            title="Endpoint unavailable"
            description={error.message}
            retry={retry}
          />
        )
      default:
        return (
          <ErrorState
            title="Unable to load analytics"
            description={error.message || 'The analytics service returned an unexpected response.'}
            retry={retry}
          />
        )
    }
  }
  return (
    <ErrorState
      title="Something went wrong"
      description="An unexpected client error occurred. Retry, or reload the page if the problem persists."
      retry={retry}
    />
  )
}
