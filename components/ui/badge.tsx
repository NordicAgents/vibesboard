import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-accent-orange focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[#EDE8DE] text-[#6B6560] hover:bg-[#E2DDD4] dark:bg-[#2E2B25] dark:text-[#9D9790] dark:hover:bg-[#3A3730]',
        primary:
          'border-transparent bg-accent-orange text-white hover:bg-accent-warm',
        secondary:
          'border-transparent bg-[#EDE8DE] text-[#6B6560] hover:bg-[#E2DDD4] dark:bg-[#2E2B25] dark:text-[#9D9790] dark:hover:bg-[#3A3730]',
        destructive:
          'border-transparent bg-destructive text-white hover:bg-destructive/80',
        outline:
          'border-[#E2DDD4] text-[#6B6560] dark:border-[#2E2B25] dark:text-[#9D9790]'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
