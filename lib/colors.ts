export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }

  const value = input.trim()
  if (!value) {
    return null
  }

  const match = value.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (!match) {
    return null
  }

  let hex = match[1].toLowerCase()
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map(ch => ch + ch)
      .join('')
  }

  return `#${hex}`
}

export function hexToHslParts(hex: string): {
  h: number
  s: number
  l: number
} {
  const normalized = normalizeHex(hex)
  if (!normalized) {
    throw new Error('Invalid hex color')
  }

  const r = parseInt(normalized.slice(1, 3), 16) / 255
  const g = parseInt(normalized.slice(3, 5), 16) / 255
  const b = parseInt(normalized.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

    switch (max) {
      case r:
        h = (g - b) / delta + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / delta + 2
        break
      default:
        h = (r - g) / delta + 4
        break
    }

    h *= 60
  }

  const round1 = (n: number) => Math.round(n * 10) / 10

  return {
    h: Math.round(h),
    s: round1(s * 100),
    l: round1(l * 100)
  }
}

export function hexToRgbParts(hex: string): {
  r: number
  g: number
  b: number
} {
  const normalized = normalizeHex(hex)
  if (!normalized) {
    throw new Error('Invalid hex color')
  }

  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  }
}

export function toCssHslVar(parts: {
  h: number
  s: number
  l: number
}): string {
  const format = (n: number) => {
    const rounded = Math.round(n * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : String(rounded)
  }

  return `${Math.round(parts.h)} ${format(parts.s)}% ${format(parts.l)}%`
}
