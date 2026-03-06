import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-accent-orange focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[#EFEFED] text-[#5A5A5A] hover:bg-[#E5E5E5] dark:bg-[#2A2A2A] dark:text-[#8A8A8A] dark:hover:bg-[#242424]',
        primary:
          'border-transparent bg-accent-orange text-white hover:bg-accent-warm',
        secondary:
          'border-transparent bg-[#EFEFED] text-[#5A5A5A] hover:bg-[#E5E5E5] dark:bg-[#2A2A2A] dark:text-[#8A8A8A] dark:hover:bg-[#242424]',
        destructive:
          'border-transparent bg-destructive text-white hover:bg-destructive/80',
        outline:
          'border-[#E5E5E5] text-[#5A5A5A] dark:border-[#2A2A2A] dark:text-[#8A8A8A]'
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
