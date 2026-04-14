'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (color: string) => void
  id?: string
  disabled?: boolean
}

export function ColorPicker({
  label,
  value,
  onChange,
  id,
  disabled
}: ColorPickerProps) {
  const [color, setColor] = useState(value)

  const handleChange = (newColor: string) => {
    setColor(newColor)
    onChange(newColor)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative">
          <input
            type="color"
            value={color}
            onChange={e => handleChange(e.target.value)}
            disabled={disabled}
            className="h-10 w-20 cursor-pointer rounded border border-input disabled:cursor-not-allowed disabled:opacity-50"
            id={id}
          />
        </div>
        <Input
          type="text"
          value={color}
          onChange={e => handleChange(e.target.value)}
          placeholder="#000000"
          pattern="^#[0-9A-Fa-f]{6}$"
          className="flex-1 font-mono"
          disabled={disabled}
        />
      </div>
    </div>
  )
}
