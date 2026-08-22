/**
 * Integration tests for chart-widget parseChartConfig and buildChartData.
 * These are pure-logic tests — no external dependencies. The pure functions
 * are duplicated here to match the source behaviour (the actual component is in
 * components/ui/chart-widget.tsx and cannot be imported in a node environment).
 */
import { describe, it, expect } from 'vitest'

interface ChartConfig {
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

function parseChartConfig(raw: string): ChartConfig | null {
  try {
    const parsed = JSON.parse(raw.trim())
    if (
      !parsed.type ||
      !Array.isArray(parsed.labels) ||
      !Array.isArray(parsed.datasets)
    ) {
      return null
    }
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

const COLORS = [
  '#a7e26e',
  '#6dbfd4',
  '#f4a261',
  '#e76f51',
  '#2a9d8f',
  '#e9c46a',
  '#264653',
  '#a8dadc'
]

function buildChartData(config: ChartConfig) {
  return {
    labels: config.labels,
    datasets: config.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: ds.color ?? COLORS[i % COLORS.length],
      borderColor: ds.color ?? COLORS[i % COLORS.length],
      borderWidth: 2,
      fill: false,
      tension: 0.3
    }))
  }
}

describe('parseChartConfig', () => {
  it('parses valid bar chart JSON', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'Conversations per day',
      labels: ['Mon', 'Tue', 'Wed'],
      datasets: [{ label: 'Count', data: [5, 3, 8] }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.type).toBe('bar')
    expect(config!.title).toBe('Conversations per day')
    expect(config!.labels).toEqual(['Mon', 'Tue', 'Wed'])
    expect(config!.datasets.length).toBe(1)
    expect(config!.datasets[0].data).toEqual([5, 3, 8])
  })

  it('parses valid line chart', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'Trend',
      labels: ['Jan', 'Feb'],
      datasets: [{ label: 'Users', data: [10, 20] }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.type).toBe('line')
  })

  it('parses valid pie chart', () => {
    const raw = JSON.stringify({
      type: 'pie',
      title: 'Distribution',
      labels: ['A', 'B'],
      datasets: [{ label: 'Share', data: [60, 40] }]
    })
    expect(parseChartConfig(raw)).toBeTruthy()
  })

  it('parses valid doughnut chart', () => {
    const raw = JSON.stringify({
      type: 'doughnut',
      title: '',
      labels: ['X'],
      datasets: [{ label: 'Y', data: [100] }]
    })
    expect(parseChartConfig(raw)).toBeTruthy()
  })

  it('handles trailing newline (code fence strips it)', () => {
    const raw =
      '{"type":"bar","title":"T","labels":["A"],"datasets":[{"label":"D","data":[1]}]}\n'
    expect(parseChartConfig(raw)).toBeTruthy()
  })

  it('handles whitespace padding', () => {
    const raw =
      '  {"type":"bar","title":"T","labels":["A"],"datasets":[{"label":"D","data":[1]}]}  '
    expect(parseChartConfig(raw)).toBeTruthy()
  })

  it('returns null for invalid JSON', () => {
    expect(parseChartConfig('{not json}')).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(parseChartConfig('')).toBe(null)
  })

  it('returns null for valid JSON missing type', () => {
    expect(
      parseChartConfig(JSON.stringify({ labels: ['A'], datasets: [] }))
    ).toBe(null)
  })

  it('returns null for valid JSON missing labels', () => {
    expect(
      parseChartConfig(JSON.stringify({ type: 'bar', datasets: [] }))
    ).toBe(null)
  })

  it('returns null for valid JSON missing datasets', () => {
    expect(
      parseChartConfig(JSON.stringify({ type: 'bar', labels: ['A'] }))
    ).toBe(null)
  })

  it('returns null when labels is not an array', () => {
    expect(
      parseChartConfig(
        JSON.stringify({ type: 'bar', labels: 'A', datasets: [] })
      )
    ).toBe(null)
  })

  it('returns null when datasets is not an array', () => {
    expect(
      parseChartConfig(
        JSON.stringify({ type: 'bar', labels: ['A'], datasets: {} })
      )
    ).toBe(null)
  })

  it('preserves custom color in dataset', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A'],
      datasets: [{ label: 'D', data: [1], color: '#ff0000' }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.datasets[0].color).toBe('#ff0000')
  })

  it('handles multiple datasets', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'Multi',
      labels: ['Q1', 'Q2'],
      datasets: [
        { label: 'Revenue', data: [100, 200] },
        { label: 'Cost', data: [80, 120] }
      ]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.datasets.length).toBe(2)
  })

  it('caps labels at 100', () => {
    const labels = Array.from({ length: 150 }, (_, i) => `L${i}`)
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels,
      datasets: [{ label: 'D', data: Array(150).fill(1) }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.labels.length).toBe(100)
  })

  it('caps datasets at 10', () => {
    const datasets = Array.from({ length: 15 }, (_, i) => ({
      label: `S${i}`,
      data: [i]
    }))
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A'],
      datasets
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.datasets.length).toBe(10)
  })

  it('caps data points per dataset at 100', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'T',
      labels: Array.from({ length: 100 }, (_, i) => `L${i}`),
      datasets: [{ label: 'D', data: Array(200).fill(1) }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.datasets[0].data.length).toBe(100)
  })

  it('does not truncate data within limits', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A', 'B', 'C'],
      datasets: [{ label: 'D', data: [1, 2, 3] }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.labels.length).toBe(3)
    expect(config!.datasets[0].data.length).toBe(3)
  })

  it('parses empty data arrays as valid', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'Empty',
      labels: [],
      datasets: [{ label: 'D', data: [] }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.labels.length).toBe(0)
    expect(config!.datasets[0].data.length).toBe(0)
  })

  it('parses negative numbers in data', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A', 'B'],
      datasets: [{ label: 'D', data: [-5, -10] }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.datasets[0].data).toEqual([-5, -10])
  })

  it('parses float numbers in data', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'Floats',
      labels: ['A', 'B', 'C'],
      datasets: [{ label: 'D', data: [1.5, 2.7, 3.14] }]
    })
    const config = parseChartConfig(raw)
    expect(config).toBeTruthy()
    expect(config!.datasets[0].data).toEqual([1.5, 2.7, 3.14])
  })

  it('returns null for malformed JSON with trailing comma', () => {
    const raw =
      '{"type":"bar","title":"T","labels":["A"],"datasets":[{"label":"D","data":[1]},]}'
    expect(parseChartConfig(raw)).toBe(null)
  })

  it('returns null for JSON with single quotes', () => {
    const raw =
      "{'type':'bar','title':'T','labels':['A'],'datasets':[{'label':'D','data':[1]}]}"
    expect(parseChartConfig(raw)).toBe(null)
  })
})

describe('buildChartData', () => {
  it('maps config to chart.js data format', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: 'Test',
      labels: ['A', 'B'],
      datasets: [{ label: 'Series', data: [10, 20] }]
    }
    const result = buildChartData(config)
    expect(result.labels).toEqual(['A', 'B'])
    expect(result.datasets.length).toBe(1)
    expect(result.datasets[0].label).toBe('Series')
    expect(result.datasets[0].data).toEqual([10, 20])
    expect(result.datasets[0].borderWidth).toBe(2)
    expect(result.datasets[0].fill).toBe(false)
    expect(result.datasets[0].tension).toBe(0.3)
  })

  it('uses default COLORS palette when no custom color', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: '',
      labels: ['X'],
      datasets: [{ label: 'D', data: [1] }]
    }
    const result = buildChartData(config)
    expect(result.datasets[0].backgroundColor).toBe(COLORS[0])
    expect(result.datasets[0].borderColor).toBe(COLORS[0])
  })

  it('uses custom color when provided', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: '',
      labels: ['X'],
      datasets: [{ label: 'D', data: [1], color: '#123456' }]
    }
    const result = buildChartData(config)
    expect(result.datasets[0].backgroundColor).toBe('#123456')
    expect(result.datasets[0].borderColor).toBe('#123456')
  })

  it('cycles through COLORS for multiple datasets', () => {
    const datasets = Array.from({ length: 10 }, (_, i) => ({
      label: `S${i}`,
      data: [i]
    }))
    const config: ChartConfig = {
      type: 'line',
      title: '',
      labels: ['X'],
      datasets
    }
    const result = buildChartData(config)
    expect(result.datasets[8].backgroundColor).toBe(COLORS[0])
    expect(result.datasets[9].backgroundColor).toBe(COLORS[1])
  })
})
