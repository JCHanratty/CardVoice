/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        'cv-dark': '#18181B',
        'cv-panel': '#1E1E22',
        'cv-accent': '#8B2252',
        'cv-accent2': '#A0325E',
        'cv-red': '#ef4444',
        'cv-gold': '#D4A847',
        'cv-border': '#2A2A2E',
        'cv-text': '#E8E4E0',
        'cv-muted': '#78716C',
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'xs':   ['0.875rem',  { lineHeight: '1.25rem'  }],
        'sm':   ['1rem',      { lineHeight: '1.5rem'   }],
        'base': ['1.125rem',  { lineHeight: '1.75rem'  }],
        'lg':   ['1.25rem',   { lineHeight: '1.75rem'  }],
        'xl':   ['1.5rem',    { lineHeight: '2rem'     }],
        '2xl':  ['1.75rem',   { lineHeight: '2.25rem'  }],
        '3xl':  ['2.25rem',   { lineHeight: '2.5rem'   }],
      },
    }
  },
  plugins: [],
}
