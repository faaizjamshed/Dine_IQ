import * as React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { DineIQMark } from './DineIQMark'
import { useAuth } from './AuthProvider'
import { PermissionDeniedState } from '@/components/errors/states'
import type { Permission } from '@/lib/permissions'

/**
 * ProtectedRoute — redirects unauthenticated visitors to /login and defers
 * rendering until session restore completes (spec §52).
 */
export function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'restoring') return <FullscreenLoader label="Restoring session…" />
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/**
 * RoleGuard — gates routes behind a permission. Unauthorized users get an
 * explanatory permission state instead of a blank page or a redirect.
 */
export function RoleGuard({ permission }: { permission: Permission }) {
  const { hasPermission, user } = useAuth()

  if (!hasPermission(permission)) {
    return <PermissionDeniedState role={user?.role.replace('_', ' ')} />
  }
  return <Outlet />
}

/** Branded full-screen loader for session restore and lazy routes. */
export function FullscreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <DineIQMark size={44} pulse />
      <p className="font-mono text-xs text-muted">{label}</p>
    </div>
  )
}
