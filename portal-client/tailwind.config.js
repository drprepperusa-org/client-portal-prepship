/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Match prepship-v4-stable: the OS system font stack (no webfont).
      // v4 deliberately dropped Geist/Bricolage Grotesque to render like v2
      // and avoid the font payload + FOUT flicker.
      fontFamily: {
        display: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'system-ui', 'sans-serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // Brand — sky blue (#03A9F4) for the glass portal
        brand: {
          DEFAULT: '#03A9F4',
          50: '#E1F5FE',
          100: '#B3E5FC',
          200: '#81D4FA',
          400: '#4FC3F7',
          500: '#03A9F4',
          600: '#0288D1',
          700: '#0277BD',
        },
        // Cohesive accent palette (per brief)
        indigo: { soft: '#03A9F4' },
        teal: { soft: '#14B8A6' },
        amber: { soft: '#F59E0B' },
        rose: { soft: '#F43F5E' },
        emerald: { soft: '#10B981' },
        ink: {
          DEFAULT: '#1E293B', // slate-800
          2: '#475569', // slate-600
          3: '#64748B', // slate-500
        },
      },
      borderRadius: {
        glass: '20px',
        'glass-lg': '24px',
        'glass-sm': '14px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(31, 41, 99, 0.12), 0 2px 8px rgba(31, 41, 99, 0.06)',
        'glass-lg': '0 20px 60px rgba(31, 41, 99, 0.18), 0 4px 16px rgba(31, 41, 99, 0.08)',
        'glass-hover': '0 16px 48px rgba(99, 102, 241, 0.18), 0 4px 12px rgba(31, 41, 99, 0.08)',
        'inner-glow': 'inset 0 1px 0 rgba(255,255,255,0.6)',
      },
      backdropBlur: { glass: '18px' },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        blob: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(40px,-50px) scale(1.1)' },
          '66%': { transform: 'translate(-30px,30px) scale(0.95)' },
        },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        fadeInUp: 'fadeInUp 0.5s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        blob: 'blob 18s ease-in-out infinite',
        'blob-slow': 'blob 26s ease-in-out infinite',
        floaty: 'floaty 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
