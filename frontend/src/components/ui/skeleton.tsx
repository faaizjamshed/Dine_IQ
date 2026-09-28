import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton — layout-matching loading placeholder (spec §18).
 * Shimmer animation is CSS-driven and disabled under reduced motion.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-surface-strong',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
