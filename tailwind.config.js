const { fontFamily } = require('tailwindcss/defaultTheme')

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        switzer: ['var(--font-switzer)', ...fontFamily.sans]
      },
      fontSize: {
        'display-xs': ['60px', { lineHeight: '1.1' }],
        'display-sm': ['80px', { lineHeight: '1.1' }],
        'display-xl': ['100px', { lineHeight: '1.1' }],
        'display-2xl': ['140px', { lineHeight: '1.1' }],
        'hero': ['clamp(48px, 8vw, 120px)', { lineHeight: '1.1' }],
        'h2': ['clamp(32px, 5vw, 60px)', { lineHeight: '1.2' }],
        'h3': ['51px', { lineHeight: '1.3' }],
        'h4': ['32px', { lineHeight: '1.4' }],
        'h5': ['18px', { lineHeight: '2.1' }],
        'body-sm': ['17px', { lineHeight: '1.6' }],
        'body-md': ['21px', { lineHeight: '1.6' }],
        'body-lg': ['24px', { lineHeight: '1.6' }]
      },
      colors: {
        'black-primary': '#050505',
        'gray-secondary': '#969696',
        'beige-bg': '#FFFEFA',
        'purewhite-bg': '#FFFFFF',
        'black-10': 'rgba(5, 5, 5, 0.1)',
        'black-25': 'rgba(5, 5, 5, 0.25)',
        'black-50': 'rgba(0, 0, 0, 0.5)',
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
        sm: 'calc(var(--radius) - 4px)'
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
          '0%': {
            transform: 'translateX(-100%)'
          },
          '100%': {
            transform: 'translateX(0)'
          }
        },
        'slide-to-left': {
          '0%': {
            transform: 'translateX(0)'
          },
          '100%': {
            transform: 'translateX(-100%)'
          }
        }
        ,
        'slide-from-right': {
          '0%': {
            transform: 'translateX(100%)'
          },
          '100%': {
            transform: 'translateX(0)'
          }
        },
        'slide-to-right': {
          '0%': {
            transform: 'translateX(0)'
          },
          '100%': {
            transform: 'translateX(100%)'
          }
        }
      },
      animation: {
        'slide-from-left':
          'slide-from-left 0.3s cubic-bezier(0.82, 0.085, 0.395, 0.895)',
        'slide-to-left':
          'slide-to-left 0.25s cubic-bezier(0.82, 0.085, 0.395, 0.895)',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
        ,
        'slide-from-right':
          'slide-from-right 0.3s cubic-bezier(0.82, 0.085, 0.395, 0.895)',
        'slide-to-right':
          'slide-to-right 0.25s cubic-bezier(0.82, 0.085, 0.395, 0.895)'
      }
    }
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')]
}
