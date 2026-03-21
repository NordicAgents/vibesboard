import * as React from 'react'

import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
 ({ className, ...props }, ref) => {
 return (
 <textarea
 className={cn(
 'flex min-h-[88px] w-full resize-y rounded-[1.125rem] border border-border bg-card px-4 py-3 text-sm text-foreground transition-all duration-150 placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50',
 className
 )}
 ref={ref}
 {...props}
 />
 )
 }
)
Textarea.displayName = 'Textarea'

export { Textarea }
