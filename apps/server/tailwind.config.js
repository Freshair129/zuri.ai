/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#E8820C',
          hover: '#F09420',
          dark: '#B86A08',
          tint: '#FDE8D0',
          surface: '#FFF8F0',
        },
        surface: {
          DEFAULT: '#F7F8FA',
          card: '#FFFFFF',
          mid: '#EFF1F3',
        },
        restblue: {
          DEFAULT: '#D6ECFA',
          text: '#3D7A9E',
        },
        mustard: {
          DEFAULT: '#C6A052',
          tint: '#F5ECD7',
        },
        ink: '#1F2937',
        muted: '#6B7280',
      },
      fontFamily: {
        sans: ['IBM Plex Sans Thai', 'Manrope', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.06)',
        warm: '0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.06)',
      },
    },
  },
  plugins: [],
}
