/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        'cv-dark': '#0f1419',
        'cv-panel': '#1a1f2e',
        'cv-accent': '#00d4aa',
        'cv-accent2': '#6366f1',
        'cv-red': '#ef4444',
        'cv-yellow': '#f59e0b',
        'cv-border': '#2d3548',
        'cv-text': '#e2e8f0',
        'cv-muted': '#64748b',
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
