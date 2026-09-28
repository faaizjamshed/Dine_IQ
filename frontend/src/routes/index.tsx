import * as React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute, RoleGuard, FullscreenLoader } from '@/features/auth/guards'
import { LoginPage } from '@/features/auth/LoginPage'

/** Executive Dashboard — eager-loaded: it is the first judging screen. */
import { DashboardPage } from '@/features/dashboard/DashboardPage'

/**
 * Lazy page registry (spec §52) — every module below the dashboard is
 * code-split so the first judging screen never carries their weight.
 * Route-level permission: /what-if requires whatif.run, /admin requires
 * admin.access; navigation items the role lacks are hidden upstream.
 */
const MenuPageLazy = React.lazy(() =>
  import('@/features/menu/MenuPage').then((m) => ({ default: m.MenuPage })),
)
const RecommendationsPageLazy = React.lazy(() =>
  import('@/features/recommendations/RecommendationsPage').then((m) => ({
    default: m.RecommendationsPage,
  })),
)
const WhatIfPageLazy = React.lazy(() =>
  import('@/features/whatif/WhatIfPage').then((m) => ({ default: m.WhatIfPage })),
)
/* Phase 3 */
const CustomersPageLazy = React.lazy(() =>
  import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
)
const BasketPageLazy = React.lazy(() =>
  import('@/features/basket/BasketPage').then((m) => ({ default: m.BasketPage })),
)
const ForecastPageLazy = React.lazy(() =>
  import('@/features/forecast/ForecastPage').then((m) => ({ default: m.ForecastPage })),
)
const WastagePageLazy = React.lazy(() =>
  import('@/features/wastage/WastagePage').then((m) => ({ default: m.WastagePage })),
)
/* Phase 4 */
const PricingPageLazy = React.lazy(() =>
  import('@/features/pricing/PricingPage').then((m) => ({ default: m.PricingPage })),
)
const LocationsPageLazy = React.lazy(() =>
  import('@/features/locations/LocationsPage').then((m) => ({ default: m.LocationsPage })),
)
const ChannelsPageLazy = React.lazy(() =>
  import('@/features/channels/ChannelsPage').then((m) => ({ default: m.ChannelsPage })),
)
const AnomaliesPageLazy = React.lazy(() =>
  import('@/features/anomalies/AnomaliesPage').then((m) => ({ default: m.AnomaliesPage })),
)
/* Phase 5 */
const ModelsPageLazy = React.lazy(() =>
  import('@/features/models/ModelsPage').then((m) => ({ default: m.ModelsPage })),
)
const ReportsPageLazy = React.lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
)
const AdminPageLazy = React.lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
)

const NotFoundLazy = React.lazy(() =>
  import('@/pages/PlaceholderPage').then((m) => ({ default: m.NotFoundPage })),
)

function LazyPage({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<FullscreenLoader />}>{children}</React.Suspense>
}

/**
 * Application routes (spec §52).
 *
 * - /login is public; everything else sits behind ProtectedRoute.
 * - RoleGuard enforces per-route permissions (admin.access for /admin,
 *   whatif.run for /what-if); navigation items the role lacks are hidden.
 * - Only the current route's data is fetched (TanStack Query per-route).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Phase 2 modules */}
          <Route
            path="/menu"
            element={
              <LazyPage>
                <MenuPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/recommendations"
            element={
              <LazyPage>
                <RecommendationsPageLazy />
              </LazyPage>
            }
          />

          {/* What-If Simulator requires the whatif.run permission */}
          <Route element={<RoleGuard permission="whatif.run" />}>
            <Route
              path="/what-if"
              element={
                <LazyPage>
                  <WhatIfPageLazy />
                </LazyPage>
              }
            />
          </Route>

          {/* Phase 3 modules */}
          <Route
            path="/customers"
            element={
              <LazyPage>
                <CustomersPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/basket"
            element={
              <LazyPage>
                <BasketPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/forecast"
            element={
              <LazyPage>
                <ForecastPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/wastage"
            element={
              <LazyPage>
                <WastagePageLazy />
              </LazyPage>
            }
          />

          {/* Phase 4 modules */}
          <Route
            path="/pricing"
            element={
              <LazyPage>
                <PricingPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/locations"
            element={
              <LazyPage>
                <LocationsPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/channels"
            element={
              <LazyPage>
                <ChannelsPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/anomalies"
            element={
              <LazyPage>
                <AnomaliesPageLazy />
              </LazyPage>
            }
          />

          {/* Phase 5 modules */}
          <Route
            path="/models"
            element={
              <LazyPage>
                <ModelsPageLazy />
              </LazyPage>
            }
          />
          <Route
            path="/reports"
            element={
              <LazyPage>
                <ReportsPageLazy />
              </LazyPage>
            }
          />

          {/* Admin is restricted to the Administrator role */}
          <Route element={<RoleGuard permission="admin.access" />}>
            <Route
              path="/admin"
              element={
                <LazyPage>
                  <AdminPageLazy />
                </LazyPage>
              }
            />
          </Route>

          <Route path="*" element={<LazyPage><NotFoundLazy /></LazyPage>} />
        </Route>
      </Route>
    </Routes>
  )
}
