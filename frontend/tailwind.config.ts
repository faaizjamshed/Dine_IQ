import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/**
 * DineIQ Analytics design tokens.
 *
 * Colors are wired to CSS variables defined in src/styles/globals.css so the
 * entire application can switch between the dark command-centre theme
 * (default) and the light theme without utility churn. Semantic names
 * (positive / negative / critical / performance classes) keep business
 * meaning out of hardcoded hex values inside components.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg)',
        'background-subtle': 'var(--bg-subtle)',
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        'surface-raised': 'var(--surface-raised)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        foreground: 'var(--fg)',
        muted: 'var(--fg-muted)',
        subtle: 'var(--fg-subtle)',
        primary: {
          DEFAULT: 'var(--primary)',
          strong: 'var(--primary-strong)',
          foreground: 'var(--primary-foreground)',
        },
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        neutral: 'var(--neutral)',
        critical: 'var(--critical)',
        high: 'var(--high)',
        medium: 'var(--medium)',
        low: 'var(--low)',
        'profit-driver': 'var(--profit-driver)',
        'volume-driver': 'var(--volume-driver)',
        'hidden-opportunity': 'var(--hidden-opportunity)',
        'low-performer': 'var(--low-performer)',
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'monospace',
        ],
      },
      fontSize: {
        'display-sm': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        glow: '0 0 24px rgba(245, 158, 11, 0.14)',
        panel: '0 12px 40px rgba(2, 6, 23, 0.45)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        'priority-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'priority-pulse': 'priority-pulse 1.6s ease-in-out infinite',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [animate],
}

export default config
