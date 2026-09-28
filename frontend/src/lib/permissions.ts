/**
 * Role & permission model (spec §21).
 *
 * The frontend uses this map to hide navigation, block routes and disable
 * controls. It is a UX convenience only — backend authorization remains the
 * authoritative enforcement layer.
 */

export type UserRole = 'admin' | 'regional_manager' | 'restaurant_manager' | 'analyst'

export type Permission =
  | 'analytics.view'
  | 'admin.access'
  | 'users.manage'
  | 'exports.run'
  | 'whatif.run'
  | 'recommendations.manage'

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  regional_manager: 'Regional Manager',
  restaurant_manager: 'Restaurant Manager',
  analyst: 'Analyst',
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'analytics.view',
    'admin.access',
    'users.manage',
    'exports.run',
    'whatif.run',
    'recommendations.manage',
  ],
  regional_manager: ['analytics.view', 'exports.run', 'whatif.run', 'recommendations.manage'],
  restaurant_manager: ['analytics.view', 'whatif.run'],
  analyst: ['analytics.view', 'exports.run', 'whatif.run'],
}

export function roleHasPermission(role: UserRole | undefined, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}
