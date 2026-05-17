import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@vibesboard/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent font-mono text-[11px] uppercase tracking-[0.14em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-soft hover:bg-accent hover:text-accent-foreground hover:shadow-md active:translate-y-px',
        destructive:
          'bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90',
        outline:
          'border-border bg-transparent text-foreground shadow-none hover:border-primary/40 hover:bg-secondary hover:text-foreground',
        secondary:
          'border-border bg-secondary text-secondary-foreground shadow-none hover:bg-accent hover:text-accent-foreground',
        ghost:
          'border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground',
        link: 'rounded-none border-none bg-transparent p-0 text-primary underline-offset-4 shadow-none hover:text-foreground hover:underline'
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 px-4 text-[10px]',
        lg: 'h-11 px-7 text-[12px]',
        icon: 'size-10 p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
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
