/**
 * Lightweight chart config type and parser — no Chart.js dependency.
 * Imported eagerly by chat-message.tsx for JSON detection.
 * The heavy ChartWidget component is loaded separately via next/dynamic.
 */

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'doughnut'
  title: string
  labels: string[]
  datasets: {
    label: string
    data: number[]
    color?: string
  }[]
}

export function parseChartConfig(raw: string): ChartConfig | null {
  try {
    const parsed = JSON.parse(raw.trim())
    if (
      !parsed.type ||
      !Array.isArray(parsed.labels) ||
      !Array.isArray(parsed.datasets)
    ) {
      return null
    }
    return parsed as ChartConfig
  } catch {
    return null
  }
}
