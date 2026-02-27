import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'rounded-[8px] bg-accent-orange text-white shadow-sm hover:bg-accent-warm active:bg-[#BF6E52]',
        destructive:
          'rounded-[8px] bg-destructive text-white shadow-sm hover:bg-destructive/90',
        outline:
          'rounded-[8px] border border-[#E2DDD4] bg-transparent text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:border-[#2E2B25] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#FDFAF5]',
        secondary:
          'rounded-[8px] border border-[#E2DDD4] bg-transparent text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:border-[#2E2B25] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#FDFAF5]',
        ghost:
          'rounded-[8px] border-0 bg-transparent text-[#6B6560] shadow-none hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#FDFAF5]',
        link: 'rounded-none text-accent-orange underline-offset-4 shadow-none hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-[8px] px-3 text-xs',
        lg: 'h-11 rounded-[8px] px-8',
        icon: 'size-9 p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
