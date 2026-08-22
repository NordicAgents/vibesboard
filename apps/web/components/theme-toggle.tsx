'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'
import { IconMoon, IconSun } from '@/components/ui/icons'

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [_, startTransition] = React.useTransition()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  // `theme` reports the raw preference — 'system' by default until the
  // visitor makes an explicit choice — which for a visitor whose OS is
  // already dark meant this button was mislabeled "Switch to dark mode"
  // while the page was already rendering dark, and clicking it then always
  // set an explicit 'light' theme (the opposite of the label). resolvedTheme
  // always reflects the actual applied appearance, system-preference
  // included, so both the label and the toggle target track reality.
  const isDarkMode = resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => {
        startTransition(() => {
          setTheme(isDarkMode ? 'light' : 'dark')
        })
      }}
    >
      {!resolvedTheme ? null : isDarkMode ? (
        <IconMoon className="transition-all" />
      ) : (
        <IconSun className="transition-all" />
      )}
      <span className="sr-only">
        {isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      </span>
    </Button>
  )
}
