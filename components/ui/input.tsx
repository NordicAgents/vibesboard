import * as React from 'react'

import { cn } from '@/lib/utils'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-none border border-[#E5E5E5] bg-[#F7F7F5] px-3 py-2 text-sm text-[#1A1A1A] transition-all duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[#8A8A8A] focus-visible:border-accent-orange focus-visible:shadow-[0_0_0_3px_rgba(0,200,83,0.15)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2A2A2A] dark:bg-[#141414] dark:text-[#F0F0F0] dark:placeholder:text-[#666666] dark:focus-visible:border-accent-orange',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
