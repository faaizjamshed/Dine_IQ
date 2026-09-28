import * as React from 'react'
import { UtensilsCrossed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dishImageSrc, dishTintIndex } from '@/lib/dishImages'

/**
 * DishThumb — small photographic thumbnail for a menu item.
 *
 * Presentation asset only: resolves a build-time bundled photo via
 * dishImages.ts (itemId first, exact-name fallback). When no photo exists —
 * or the image fails to load — it degrades to a tinted initial tile so the
 * layout never shows a broken image. The component renders zero business
 * values; data on screen still comes exclusively from the API.
 *
 * `alt` is intentionally empty: the dish name is always adjacent as text,
 * so the thumbnail is decorative for assistive technology.
 */

const SIZES = {
  xs: 'h-6 w-6 rounded-md text-[9px]',
  sm: 'h-8 w-8 rounded-lg text-[10px]',
  md: 'h-10 w-10 rounded-lg text-xs',
  lg: 'h-14 w-14 rounded-xl text-sm',
} as const

const TINTS = [
  'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  'from-sky-500/25 to-sky-500/5 text-sky-500',
  'from-violet-500/25 to-violet-500/5 text-violet-500',
  'from-amber-500/25 to-amber-500/5 text-amber-500',
  'from-rose-500/25 to-rose-500/5 text-rose-500',
] as const

export function DishThumb({
  itemId,
  name,
  size = 'sm',
  className,
}: {
  itemId?: string | null
  name: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | undefined>()
  const src = React.useMemo(() => dishImageSrc(itemId, name), [itemId, name])
  const tint = TINTS[dishTintIndex(name, TINTS.length)]
  const showImg = Boolean(src) && failedSrc !== src

  return (
    <span
      aria-hidden
      title={`${name} — illustrative food photo`}
      className={cn(
        'relative inline-block shrink-0 overflow-hidden ring-1 ring-inset ring-border',
        SIZES[size],
        !showImg && cn('bg-gradient-to-br', tint),
        className,
      )}
    >
      {showImg ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : name ? (
        <span className="flex h-full w-full items-center justify-center font-bold uppercase">
          {name.charAt(0)}
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <UtensilsCrossed className="h-1/2 w-1/2" />
        </span>
      )}
    </span>
  )
}
