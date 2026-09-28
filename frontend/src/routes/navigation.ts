import {
  LayoutDashboard,
  UtensilsCrossed,
  Users,
  ShoppingBasket,
  TrendingUp,
  Recycle,
  MapPin,
  Smartphone,
  BellRing,
  Lightbulb,
  FlaskConical,
  GitCompareArrows,
  FileText,
  Settings2,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'

/**
 * Navigation & route registry.
 *
 * `phase` marks when the module's full implementation lands (spec §54);
 * unbuilt modules render an honest phase placeholder — never fake data.
 */
export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  permission: Permission
  phase: 1 | 2 | 3 | 4 | 5
  description: string
  /** True once the module's real page ships — sidebar drops the phase chip. */
  live?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        path: '/dashboard',
        label: 'Executive Dashboard',
        icon: LayoutDashboard,
        permission: 'analytics.view',
        phase: 1,
        live: true,
        description: 'Cross-outlet performance, anomalies and priority actions at a glance.',
      },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      {
        path: '/menu',
        label: 'Menu Intelligence',
        icon: UtensilsCrossed,
        permission: 'analytics.view',
        phase: 2,
        live: true,
        description: 'Popularity × margin analysis, performance classes and tricky menu cases.',
      },
      {
        path: '/customers',
        label: 'Customer Intelligence',
        icon: Users,
        permission: 'analytics.view',
        phase: 3,
        live: true,
        description: 'Segments, RFM value tiers, churn risk and promotion sensitivity.',
      },
      {
        path: '/basket',
        label: 'Basket & Bundles',
        icon: ShoppingBasket,
        permission: 'analytics.view',
        phase: 3,
        live: true,
        description: 'Association rules, bundle opportunities and cross-sell evidence.',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        path: '/forecast',
        label: 'Demand Forecast',
        icon: TrendingUp,
        permission: 'analytics.view',
        phase: 3,
        live: true,
        description: 'Hourly demand predictions with explicit lag inputs and historical model metrics.',
      },
      {
        path: '/wastage',
        label: 'Wastage',
        icon: Recycle,
        permission: 'analytics.view',
        phase: 3,
        live: true,
        description: 'Wastage cost, item/outlet breakdowns and over-preparation risk.',
      },
      {
        path: '/locations',
        label: 'Locations',
        icon: MapPin,
        permission: 'analytics.view',
        phase: 4,
        live: true,
        description: 'Outlet comparison, location menu matrix and anomalous outlet flags.',
      },
      {
        path: '/channels',
        label: 'Channels',
        icon: Smartphone,
        permission: 'analytics.view',
        phase: 4,
        live: true,
        description: 'Dine-in, takeaway, delivery and app economics side by side.',
      },
    ],
  },
  {
    label: 'Decisions & Actions',
    items: [
      {
        path: '/pricing',
        label: 'Pricing & Promotions',
        icon: FileText,
        permission: 'analytics.view',
        phase: 4,
        live: true,
        description: 'Price elasticity, promotion effectiveness and promotion traps.',
      },
      {
        path: '/anomalies',
        label: 'Anomalies',
        icon: BellRing,
        permission: 'analytics.view',
        phase: 4,
        live: true,
        description: 'Detected sales spikes, drops, duplicates and rating events with evidence.',
      },
      {
        path: '/recommendations',
        label: 'Recommendations',
        icon: Lightbulb,
        permission: 'analytics.view',
        phase: 2,
        live: true,
        description: 'Historical actions and their supporting evidence.',
      },
      {
        path: '/what-if',
        label: 'What-If Simulator',
        icon: FlaskConical,
        permission: 'whatif.run',
        phase: 2,
        live: true,
        description: 'Simulate price, discount and preparation changes — estimates, never actuals.',
      },
    ],
  },
  {
    label: 'Platform',
    items: [
      {
        path: '/models',
        label: 'Model Comparison',
        icon: GitCompareArrows,
        permission: 'analytics.view',
        phase: 5,
        live: true,
        description: 'Spark vs Python pipeline agreement, metrics and record-level diffs.',
      },
      {
        path: '/reports',
        label: 'Reports & Export',
        icon: FileText,
        permission: 'analytics.view',
        phase: 5,
        live: true,
        description: 'Existing analytical reports with CSV download and role-aware access.',
      },
      {
        path: '/admin',
        label: 'Admin',
        icon: Settings2,
        permission: 'admin.access',
        phase: 5,
        live: true,
        description: 'Saved Spark evidence, model artifacts and administrator audit trail.',
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** Every role passes analytics.view; the menu hides items the role lacks. */
export function visibleNavGroups(hasPermission: (p: Permission) => boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0)
}
