'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'

import { cn } from '@/lib/utils'
import {
  IconArrowDown,
  IconCheck,
  IconChevronUpDown
} from '@/components/ui/icons'

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-11 w-full items-center justify-between rounded-[8px] border border-[#E5E5E5] bg-[#F7F7F5] px-3 py-2 text-sm text-[#1A1A1A] transition-all duration-150 placeholder:text-[#8A8A8A] focus:border-accent-orange focus:shadow-[0_0_0_3px_rgba(0,200,83,0.15)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-[#8A8A8A] dark:border-[#2A2A2A] dark:bg-[#141414] dark:text-[#F7F7F5] dark:focus:border-accent-orange dark:data-[placeholder]:text-[#5A5A5A]',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <IconChevronUpDown className="shrink-0 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 min-w-32 overflow-hidden rounded-xl border border-[#E5E5E5] bg-[#F7F7F5] text-[#1A1A1A] shadow-soft animate-in fade-in-80 dark:border-[#2A2A2A] dark:bg-[#141414] dark:text-[#F7F7F5]',
        position === 'popper' && 'translate-y-1',
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('py-1.5 pl-8 pr-2 text-xs font-semibold uppercase tracking-wide text-[#8A8A8A] dark:text-[#A0A0A0]', className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-[6px] py-1.5 pl-8 pr-2 text-sm text-[#1A1A1A] outline-none transition-colors duration-100 focus:bg-[#EFEFED] focus:text-[#1A1A1A] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-[#F7F7F5] dark:focus:bg-[#2A2A2A] dark:focus:text-[#F7F7F5]',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <IconCheck className="size-4 text-accent-orange" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-[#E5E5E5] dark:bg-[#2A2A2A]', className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator
}
