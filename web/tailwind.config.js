/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    fontFamily: {
      sans: ['Prompt', 'system-ui', 'sans-serif'],
    },
    extend: {
      colors: {
        // ---- Brand (LA-Organizer-UI-SYSTEM §5.1) ----
        brand: {
          DEFAULT: '#E91451',
          shade: '#B01545',
          deep: '#740A28',
          light: '#F06292',
          dark: '#373435',
        },
        // ---- Neutrals ----
        ink: {
          0: '#0A0A0A',
          50: '#141414',
          100: '#1A1A1A',
          200: '#2A2A2A',
          300: '#424242',
          400: '#7A7A7A',
          500: '#9E9E9E',
          600: '#CFCFCF',
          700: '#E0E0E0',
          800: '#E8E8E8',
          900: '#F4F4F4',
          1000: '#FFFFFF',
        },
        // ---- Semantic (operational; never replaced by brand pink) ----
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
        project: '#8B5CF6',
        // ---- Theme-aware tokens (resolved via CSS vars) ----
        bg: {
          app: 'rgb(var(--bg-app) / <alpha-value>)',
          surface: 'rgb(var(--bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--fg-secondary) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
        },
      },
      fontSize: {
        // §5.3 escala operacional
        'screen-title': ['1.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        'section-title': ['1.25rem', { lineHeight: '1.25', fontWeight: '700' }],
        'card-title': ['1.125rem', { lineHeight: '1.3', fontWeight: '600' }],
        'body-lg': ['1rem', { lineHeight: '1.5', fontWeight: '500' }],
        'body-md': ['0.9375rem', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.45', fontWeight: '400' }],
        'label': ['0.75rem', { lineHeight: '1.2', fontWeight: '700' }],
        // §5.3 escala derivada da marca
        'hero': ['6rem', { lineHeight: '0.95', fontWeight: '900' }],
        'h1-brand': ['3.5rem', { lineHeight: '1', fontWeight: '900' }],
        'h2-brand': ['2.5rem', { lineHeight: '1.05', fontWeight: '900' }],
      },
      spacing: {
        // §5.4
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
        'xl': '32px',
        '2xl': '48px',
      },
      borderRadius: {
        // §5.5
        sm: '10px',
        md: '16px',
        lg: '20px',
        brand: '18px',
      },
      boxShadow: {
        soft: '0 6px 20px rgba(0,0,0,0.22)',
        'offset-brand': '8px 8px 0 rgba(0,0,0,0.28)',
        // Light-mode card depth — soft, neutral. Pair with `dark:shadow-none`.
        card: '0 1px 2px rgba(15,15,15,0.04), 0 2px 6px rgba(15,15,15,0.06)',
      },
      maxWidth: {
        screen: '480px',
        content: '720px',
      },
    },
  },
  plugins: [],
};
