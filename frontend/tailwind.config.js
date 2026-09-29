/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc7fb',
          400: '#38a8f8',
          500: '#0e8ce9',
          600: '#026fc7',
          700: '#0358a1',
          800: '#074b84',
          900: '#0c3f6e',
          950: '#082849',
        },
        skybg: {
          light: '#f5f9ff',
          card: '#ffffff',
          border: '#dbeafe',
          soft: '#eef6ff',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translate(-50%, 60%)' },
          to: { opacity: '1', transform: 'translate(-50%, 50%)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 15px rgba(56, 168, 248, 0.25)' },
          '50%': { boxShadow: '0 0 30px rgba(56, 168, 248, 0.55)' },
        },
        'haptic-bounce': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(0.96)' },
          '70%': { transform: 'scale(1.03)' },
          '100%': { transform: 'scale(1)' },
        },
        'ripple': {
          '0%': { transform: 'scale(0.8)', opacity: '1' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'marquee': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'word-in': {
          from: { opacity: '0', transform: 'translateY(0.4em) rotateX(-40deg)', filter: 'blur(6px)' },
          to: { opacity: '1', transform: 'translateY(0) rotateX(0)', filter: 'blur(0)' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'draw-line': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.8s ease-out',
        'fade-in': 'fade-in 0.8s ease-out',
        'pulse-glow': 'pulse-glow 2.5s infinite',
        'haptic-bounce': 'haptic-bounce 0.35s ease-out',
        'ripple': 'ripple 1.2s cubic-bezier(0, 0.2, 0.8, 1) infinite',
        'float': 'float 5s ease-in-out infinite',
        'shimmer': 'shimmer 1.8s linear infinite',
        'marquee': 'marquee 35s linear infinite',
        'word-in': 'word-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'gradient-pan': 'gradient-pan 6s ease infinite',
        'draw-line': 'draw-line 1.4s cubic-bezier(0.16, 1, 0.3, 1) both',
      }
    },
  },
  plugins: [],
}
