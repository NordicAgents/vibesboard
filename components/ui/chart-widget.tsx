'use client'

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2'
import type { ChartConfig } from './chart-config'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
)

export type { ChartConfig }

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

const baseOptions = (title: string) => ({
  responsive: true,
  plugins: {
    legend: { position: 'top' as const },
    title: { display: !!title, text: title },
  },
})

export function ChartWidget({ config }: { config: ChartConfig }) {
  const data = buildChartData(config)
  const opts = baseOptions(config.title)

  return (
    <div className="mt-3 rounded border border-[#e4e3e3] bg-[#f5f8f7] p-4 dark:border-[#344348] dark:bg-[#192425]">
      {config.type === 'bar' && <Bar data={data} options={opts} />}
      {config.type === 'line' && <Line data={data} options={opts} />}
      {config.type === 'pie' && <Pie data={data} options={opts} />}
      {config.type === 'doughnut' && <Doughnut data={data} options={opts} />}
    </div>
  )
}

// parseChartConfig lives in ./chart-config.ts (no Chart.js dependency)
export { parseChartConfig } from './chart-config'
