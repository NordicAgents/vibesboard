import defaultTheme from 'tailwindcss/defaultTheme'
import tailwindcssAnimate from 'tailwindcss-animate'
import typography from '@tailwindcss/typography'

const { fontFamily } = defaultTheme

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ['class'],
  content: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
  theme: {
    screens: {
      xs: '475px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1400px'
    },
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.5rem',
        lg: '2rem'
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1400px'
      }
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        serif: ['var(--font-sans)', ...fontFamily.sans],
        mono: ['var(--font-mono)', ...fontFamily.mono],
        switzer: ['var(--font-sans)', ...fontFamily.sans]
      },
      fontSize: {
        'display-xs': ['56px', { lineHeight: '1.02' }],
        'display-sm': ['72px', { lineHeight: '1.02' }],
        'display-xl': ['96px', { lineHeight: '1.02' }],
        'display-2xl': ['132px', { lineHeight: '0.98' }],
        hero: ['clamp(52px, 8vw, 116px)', { lineHeight: '0.98' }],
        h2: ['clamp(34px, 5vw, 62px)', { lineHeight: '1.04' }],
        h3: ['48px', { lineHeight: '1.08' }],
        h4: ['30px', { lineHeight: '1.14' }],
        h5: ['18px', { lineHeight: '1.4' }],
        'body-sm': ['14px', { lineHeight: '1.6' }],
        'body-md': ['16px', { lineHeight: '1.65' }],
        'body-lg': ['20px', { lineHeight: '1.55' }]
      },
      colors: {
        'bg-base': 'var(--bg-base)',
        'bg-surface': 'var(--bg-surface)',
        'bg-hover': 'var(--bg-hover)',
        'bg-muted': 'var(--bg-muted)',
        'border-warm': 'var(--border-warm)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'accent-orange': 'var(--accent-orange)',
        'accent-warm': 'var(--accent-warm)',

        'black-primary': 'var(--black-primary)',
        'gray-secondary': 'var(--gray-secondary)',
        'beige-bg': 'var(--beige-bg)',
        'purewhite-bg': 'var(--purewhite-bg)',
        'black-10': 'rgba(0, 0, 0, 0.1)',
        'black-25': 'rgba(0, 0, 0, 0.25)',
        'black-50': 'rgba(0, 0, 0, 0.5)',

        /* ── Shadcn/Radix tokens ── */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        }
      },
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: `calc(var(--radius) - 6px)`,
        xs: `calc(var(--radius) - 10px)`
      },
      boxShadow: {
        soft: '0 12px 30px rgba(34, 47, 48, 0.06), 0 2px 10px rgba(34, 47, 48, 0.04)',
        md: '0 20px 48px rgba(34, 47, 48, 0.14), 0 8px 18px rgba(34, 47, 48, 0.08)',
        'orange-glow': '0 0 0 4px rgba(167, 226, 110, 0.22)'
      },
      transitionTimingFunction: {
        claude: 'cubic-bezier(0.16, 1, 0.3, 1)',
        gentle: 'cubic-bezier(0.4, 0, 0.2, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        custom: 'cubic-bezier(0.21, 0.47, 0.32, 0.98)'
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 }
        },
        'slide-from-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' }
        },
        'slide-to-left': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' }
        },
        'slide-from-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' }
        },
        'slide-to-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' }
        },
        'fade-slide-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' }
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-from-left': 'slide-from-left 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-to-left': 'slide-to-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-from-right':
          'slide-from-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-to-right': 'slide-to-right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        'fade-slide-in':
          'fade-slide-in 250ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        shimmer: 'shimmer 1.5s linear infinite',
        marquee: 'marquee 30s linear infinite'
      }
    }
  },
  plugins: [tailwindcssAnimate, typography]
}

export default config
