import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 和モダン × ネオン パレット
        ink: {
          950: '#0A0F1C', // 深藍
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
        },
        gold: {
          DEFAULT: '#D4AF37',
          light: '#E5C158',
          dark: '#9C7E1F',
        },
        jade: {
          DEFAULT: '#10B981', // 翡翠
          light: '#34D399',
          dark: '#047857',
        },
        cinnabar: {
          DEFAULT: '#DC2626', // 朱
          light: '#EF4444',
          dark: '#991B1B',
        },
        violet: {
          950: '#2E1065',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Hiragino Sans', 'Yu Gothic', 'sans-serif'],
        serif: ['"Hiragino Mincho ProN"', 'YuMincho', 'serif'],
      },
      keyframes: {
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '0.5' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(212, 175, 55, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(212, 175, 55, 0.6)' },
        },
        bloom: {
          '0%': { transform: 'scale(0.8) rotate(-5deg)', opacity: '0' },
          '100%': { transform: 'scale(1) rotate(0)', opacity: '1' },
        },
      },
      animation: {
        ripple: 'ripple 0.6s ease-out',
        glow: 'glow 3s ease-in-out infinite',
        bloom: 'bloom 0.4s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
