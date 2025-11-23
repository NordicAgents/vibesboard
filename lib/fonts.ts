import { JetBrains_Mono as FontMono, Inter as FontSans } from 'next/font/google'

export const fontSans = FontSans({
  subsets: ['latin'],
  variable: '--font-sans'
})

export const fontMono = FontMono({
  subsets: ['latin'],
  variable: '--font-mono'
})

// Using Inter as a fallback for Switzer until actual Switzer font files are added
// To use actual Switzer fonts, add the .woff2 files to assets/fonts/ and uncomment below:
/*
import localFont from 'next/font/local'
export const fontSwitzer = localFont({
  src: [
    {
      path: '../assets/fonts/Switzer-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../assets/fonts/Switzer-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../assets/fonts/Switzer-Semibold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../assets/fonts/Switzer-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-switzer',
})
*/

// Temporary: Use Inter as Switzer fallback
export const fontSwitzer = FontSans({
  subsets: ['latin'],
  variable: '--font-switzer'
})


