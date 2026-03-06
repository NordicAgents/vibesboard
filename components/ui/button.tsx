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
          'rounded-none bg-[#1A1A1A] text-white shadow-sm hover:opacity-85 active:opacity-75 dark:bg-[#F0F0F0] dark:text-[#0A0A0A]',
        destructive:
          'rounded-none bg-destructive text-white shadow-sm hover:bg-destructive/90',
        outline:
          'rounded-none border border-[#E5E5E5] bg-transparent text-[#5A5A5A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:border-[#2A2A2A] dark:text-[#A0A0A0] dark:hover:bg-[#1E1E1E] dark:hover:text-[#F0F0F0]',
        secondary:
          'rounded-none border border-[#E5E5E5] bg-transparent text-[#5A5A5A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:border-[#2A2A2A] dark:text-[#A0A0A0] dark:hover:bg-[#1E1E1E] dark:hover:text-[#F0F0F0]',
        ghost:
          'rounded-none border-0 bg-transparent text-[#5A5A5A] shadow-none hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:text-[#A0A0A0] dark:hover:bg-[#1E1E1E] dark:hover:text-[#F0F0F0]',
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
