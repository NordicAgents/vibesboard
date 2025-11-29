import localFont from 'next/font/local'

// Self-hosted Inter for sans + Switzer fallback
export const fontSans = localFont({
  src: [
    {
      path: '../assets/fonts/Inter-Regular.woff',
      weight: '400',
      style: 'normal'
    },
    {
      path: '../assets/fonts/Inter-Bold.woff',
      weight: '700',
      style: 'normal'
    }
  ],
  variable: '--font-sans',
  fallback: ['system-ui', 'sans-serif']
})

// Reuse Inter for mono until a dedicated mono font is added
export const fontMono = localFont({
  src: [
    {
      path: '../assets/fonts/Inter-Regular.woff',
      weight: '400',
      style: 'normal'
    }
  ],
  variable: '--font-mono',
  fallback: [
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Monaco',
    'Consolas',
    'Liberation Mono',
    'Courier New',
    'monospace'
  ]
})

// Switzer fallback: also use Inter but with its own CSS variable
export const fontSwitzer = localFont({
  src: [
    {
      path: '../assets/fonts/Inter-Regular.woff',
      weight: '400',
      style: 'normal'
    },
    {
      path: '../assets/fonts/Inter-Bold.woff',
      weight: '700',
      style: 'normal'
    }
  ],
  variable: '--font-switzer',
  fallback: ['system-ui', 'sans-serif']
})

