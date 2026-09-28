import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Semantic badges. Priority and severity variants follow spec §09
 * (Critical = red + pulse, High = orange, Medium = amber, Low = slate) and
 * business-class variants follow spec §08.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-surface-strong text-muted',
        outline: 'border-border text-muted',
        primary: 'border-transparent bg-primary/15 text-primary',
        positive: 'border-transparent bg-positive/15 text-positive',
        negative: 'border-transparent bg-negative/15 text-negative',
        neutral: 'border-transparent bg-surface-strong text-neutral',
        critical: 'border-critical/40 bg-critical/15 text-critical',
        high: 'border-high/40 bg-high/15 text-high',
        medium: 'border-medium/40 bg-medium/15 text-medium',
        low: 'border-low/40 bg-low/15 text-neutral',
        'profit-driver': 'border-profit-driver/40 bg-profit-driver/15 text-profit-driver',
        'volume-driver': 'border-volume-driver/40 bg-volume-driver/15 text-volume-driver',
        'hidden-opportunity': 'border-hidden-opportunity/40 bg-hidden-opportunity/15 text-hidden-opportunity',
        'low-performer': 'border-low-performer/40 bg-low-performer/15 text-low-performer',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
