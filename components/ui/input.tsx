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
          'flex h-11 w-full rounded-[8px] border border-[#E2DDD4] bg-[#FDFAF5] px-3 py-2 text-sm text-[#1A1915] transition-all duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[#9D9790] focus-visible:border-accent-orange focus-visible:shadow-[0_0_0_3px_rgba(217,119,87,0.15)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2E2B25] dark:bg-[#221F1A] dark:text-[#FDFAF5] dark:placeholder:text-[#6B6560] dark:focus-visible:border-accent-orange',
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
