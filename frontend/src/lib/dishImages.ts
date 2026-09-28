import { DISH_IMAGES } from '@/generated/dishImages.generated'

/**
 * dishImages — static photo lookup for menu items (presentation assets only).
 *
 * The map is generated from the canonical dataset menu catalogue
 * (scripts/build-dish-images.py) and bundled with the app, exactly like an
 * icon set. It carries NO business values — every price, revenue figure or
 * metric on screen still comes from the typed API. The same `itemId` appears
 * in kpis.topBottomDishes, basket bundles/rules, forecast rows, wastage rows,
 * recommendation entity refs and the menu table, so one map covers every
 * surface. Category photos are illustrative; numbered variants share imagery.
 * A lowercase name index provides a fallback for payloads that
 * reference dishes by name only.
 */

const NAME_INDEX: Record<string, string> = {}
for (const [itemId, entry] of Object.entries(DISH_IMAGES)) {
  NAME_INDEX[normalizeName(entry.name)] = itemId
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Resolve a bundled photo path for a dish, or undefined when none exists. */
export function dishImageSrc(itemId?: string | null, name?: string | null): string | undefined {
  if (itemId && DISH_IMAGES[itemId]) return DISH_IMAGES[itemId].src
  if (name) {
    const hit = NAME_INDEX[normalizeName(name)]
    if (hit && DISH_IMAGES[hit]) return DISH_IMAGES[hit].src
  }
  return undefined
}

/** Deterministic small hash so fallback tiles get a stable tint per dish. */
export function dishTintIndex(name: string, buckets = 5): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % buckets
}
