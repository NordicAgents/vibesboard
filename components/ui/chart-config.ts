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

const MAX_LABELS = 100
const MAX_DATASETS = 10
const MAX_DATA_POINTS = 100

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
    // Cap data size to prevent rendering issues from oversized LLM output
    if (parsed.labels.length > MAX_LABELS) {
      parsed.labels = parsed.labels.slice(0, MAX_LABELS)
    }
    if (parsed.datasets.length > MAX_DATASETS) {
      parsed.datasets = parsed.datasets.slice(0, MAX_DATASETS)
    }
    for (const ds of parsed.datasets) {
      if (Array.isArray(ds.data) && ds.data.length > MAX_DATA_POINTS) {
        ds.data = ds.data.slice(0, MAX_DATA_POINTS)
      }
    }
    return parsed as ChartConfig
  } catch {
    return null
  }
}
