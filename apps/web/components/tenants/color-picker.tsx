'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (color: string) => void
  id?: string
  disabled?: boolean
}

// Fully controlled by `value` — no internal state. This used to seed a local
// `color` state from `value` once at mount, which silently froze the swatch
// and text input whenever the parent's value changed afterward (e.g. an
// async branding fetch resolving after mount, or a "Reset to Defaults"
// click), while anything reading the parent's own state directly (like a
// live preview panel) updated correctly — a visible desync between the two.
export function ColorPicker({
  label,
  value,
  onChange,
  id,
  disabled
}: ColorPickerProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative">
          <input
            type="color"
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            className="h-10 w-20 cursor-pointer rounded border border-input disabled:cursor-not-allowed disabled:opacity-50"
            id={id}
          />
        </div>
        <Input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#000000"
          pattern="^#[0-9A-Fa-f]{6}$"
          className="flex-1 font-mono"
          disabled={disabled}
        />
      </div>
    </div>
  )
}
