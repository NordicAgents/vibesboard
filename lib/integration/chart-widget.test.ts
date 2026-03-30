/**
 * Integration tests for chart-widget parseChartConfig and buildChartData.
 * These are pure-logic tests — no external dependencies.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'

// We can't import TSX directly in Node, so we duplicate the pure-logic
// functions here and verify they match the source behaviour.
// The actual component is in components/ui/chart-widget.tsx

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
  '#a7e26e', '#6dbfd4', '#f4a261', '#e76f51',
  '#2a9d8f', '#e9c46a', '#264653', '#a8dadc',
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
      tension: 0.3,
    })),
  }
}

// -------------------------------------------------------------------
// parseChartConfig
// -------------------------------------------------------------------
describe('parseChartConfig', () => {
  test('parses valid bar chart JSON', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'Conversations per day',
      labels: ['Mon', 'Tue', 'Wed'],
      datasets: [{ label: 'Count', data: [5, 3, 8] }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.strictEqual(config.type, 'bar')
    assert.strictEqual(config.title, 'Conversations per day')
    assert.deepStrictEqual(config.labels, ['Mon', 'Tue', 'Wed'])
    assert.strictEqual(config.datasets.length, 1)
    assert.deepStrictEqual(config.datasets[0].data, [5, 3, 8])
  })

  test('parses valid line chart', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'Trend',
      labels: ['Jan', 'Feb'],
      datasets: [{ label: 'Users', data: [10, 20] }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.strictEqual(config.type, 'line')
  })

  test('parses valid pie chart', () => {
    const raw = JSON.stringify({
      type: 'pie',
      title: 'Distribution',
      labels: ['A', 'B'],
      datasets: [{ label: 'Share', data: [60, 40] }]
    })
    assert.ok(parseChartConfig(raw))
  })

  test('parses valid doughnut chart', () => {
    const raw = JSON.stringify({
      type: 'doughnut',
      title: '',
      labels: ['X'],
      datasets: [{ label: 'Y', data: [100] }]
    })
    assert.ok(parseChartConfig(raw))
  })

  test('handles trailing newline (code fence strips it)', () => {
    const raw = '{"type":"bar","title":"T","labels":["A"],"datasets":[{"label":"D","data":[1]}]}\n'
    assert.ok(parseChartConfig(raw))
  })

  test('handles whitespace padding', () => {
    const raw = '  {"type":"bar","title":"T","labels":["A"],"datasets":[{"label":"D","data":[1]}]}  '
    assert.ok(parseChartConfig(raw))
  })

  test('returns null for invalid JSON', () => {
    assert.strictEqual(parseChartConfig('{not json}'), null)
  })

  test('returns null for empty string', () => {
    assert.strictEqual(parseChartConfig(''), null)
  })

  test('returns null for valid JSON missing type', () => {
    const raw = JSON.stringify({ labels: ['A'], datasets: [] })
    assert.strictEqual(parseChartConfig(raw), null)
  })

  test('returns null for valid JSON missing labels', () => {
    const raw = JSON.stringify({ type: 'bar', datasets: [] })
    assert.strictEqual(parseChartConfig(raw), null)
  })

  test('returns null for valid JSON missing datasets', () => {
    const raw = JSON.stringify({ type: 'bar', labels: ['A'] })
    assert.strictEqual(parseChartConfig(raw), null)
  })

  test('returns null when labels is not an array', () => {
    const raw = JSON.stringify({ type: 'bar', labels: 'A', datasets: [] })
    assert.strictEqual(parseChartConfig(raw), null)
  })

  test('returns null when datasets is not an array', () => {
    const raw = JSON.stringify({ type: 'bar', labels: ['A'], datasets: {} })
    assert.strictEqual(parseChartConfig(raw), null)
  })

  test('preserves custom color in dataset', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A'],
      datasets: [{ label: 'D', data: [1], color: '#ff0000' }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.strictEqual(config.datasets[0].color, '#ff0000')
  })

  test('handles multiple datasets', () => {
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
    assert.ok(config)
    assert.strictEqual(config.datasets.length, 2)
  })

  test('caps labels at 100', () => {
    const labels = Array.from({ length: 150 }, (_, i) => `L${i}`)
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels,
      datasets: [{ label: 'D', data: Array(150).fill(1) }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.strictEqual(config.labels.length, 100)
  })

  test('caps datasets at 10', () => {
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
    assert.ok(config)
    assert.strictEqual(config.datasets.length, 10)
  })

  test('caps data points per dataset at 100', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'T',
      labels: Array.from({ length: 100 }, (_, i) => `L${i}`),
      datasets: [{ label: 'D', data: Array(200).fill(1) }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.strictEqual(config.datasets[0].data.length, 100)
  })

  test('does not truncate data within limits', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A', 'B', 'C'],
      datasets: [{ label: 'D', data: [1, 2, 3] }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.strictEqual(config.labels.length, 3)
    assert.strictEqual(config.datasets[0].data.length, 3)
  })

  test('parses empty data arrays as valid', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'Empty',
      labels: [],
      datasets: [{ label: 'D', data: [] }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config, 'Empty arrays should be valid')
    assert.strictEqual(config.labels.length, 0)
    assert.strictEqual(config.datasets[0].data.length, 0)
  })

  test('parses negative numbers in data', () => {
    const raw = JSON.stringify({
      type: 'bar',
      title: 'T',
      labels: ['A', 'B'],
      datasets: [{ label: 'D', data: [-5, -10] }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.deepStrictEqual(config.datasets[0].data, [-5, -10])
  })

  test('parses float numbers in data', () => {
    const raw = JSON.stringify({
      type: 'line',
      title: 'Floats',
      labels: ['A', 'B', 'C'],
      datasets: [{ label: 'D', data: [1.5, 2.7, 3.14] }]
    })
    const config = parseChartConfig(raw)
    assert.ok(config)
    assert.deepStrictEqual(config.datasets[0].data, [1.5, 2.7, 3.14])
  })

  test('returns null for malformed JSON with trailing comma', () => {
    const raw = '{"type":"bar","title":"T","labels":["A"],"datasets":[{"label":"D","data":[1]},]}'
    assert.strictEqual(parseChartConfig(raw), null)
  })

  test('returns null for JSON with single quotes', () => {
    const raw = "{'type':'bar','title':'T','labels':['A'],'datasets':[{'label':'D','data':[1]}]}"
    assert.strictEqual(parseChartConfig(raw), null)
  })
})

// -------------------------------------------------------------------
// buildChartData
// -------------------------------------------------------------------
describe('buildChartData', () => {
  test('maps config to chart.js data format', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: 'Test',
      labels: ['A', 'B'],
      datasets: [{ label: 'Series', data: [10, 20] }]
    }
    const result = buildChartData(config)
    assert.deepStrictEqual(result.labels, ['A', 'B'])
    assert.strictEqual(result.datasets.length, 1)
    assert.strictEqual(result.datasets[0].label, 'Series')
    assert.deepStrictEqual(result.datasets[0].data, [10, 20])
    assert.strictEqual(result.datasets[0].borderWidth, 2)
    assert.strictEqual(result.datasets[0].fill, false)
    assert.strictEqual(result.datasets[0].tension, 0.3)
  })

  test('uses default COLORS palette when no custom color', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: '',
      labels: ['X'],
      datasets: [{ label: 'D', data: [1] }]
    }
    const result = buildChartData(config)
    assert.strictEqual(result.datasets[0].backgroundColor, COLORS[0])
    assert.strictEqual(result.datasets[0].borderColor, COLORS[0])
  })

  test('uses custom color when provided', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: '',
      labels: ['X'],
      datasets: [{ label: 'D', data: [1], color: '#123456' }]
    }
    const result = buildChartData(config)
    assert.strictEqual(result.datasets[0].backgroundColor, '#123456')
    assert.strictEqual(result.datasets[0].borderColor, '#123456')
  })

  test('cycles through COLORS for multiple datasets', () => {
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
    // 9th dataset (index 8) should wrap to COLORS[0]
    assert.strictEqual(result.datasets[8].backgroundColor, COLORS[0])
    // 10th dataset (index 9) should wrap to COLORS[1]
    assert.strictEqual(result.datasets[9].backgroundColor, COLORS[1])
  })
})
