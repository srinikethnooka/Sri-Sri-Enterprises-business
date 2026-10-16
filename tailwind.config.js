/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: { 50: '#FFFDF8', 100: '#FBF6EC', 200: '#F4EBD8', 300: '#E9DCC1' },
        burgundy: { 50: '#FBEFF1', 100: '#F3D6DC', 200: '#E3A9B5', 400: '#A7384F', 600: '#8A1F35', 700: '#731729', 800: '#5C1221', 900: '#410C17' },
        gold: { 100: '#F5ECD6', 300: '#DCC184', 500: '#B08C45', 700: '#7C602A' },
        ink: { 400: '#8A817A', 500: '#6B6159', 700: '#3C342E', 900: '#211C19' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      boxShadow: { card: '0 1px 2px rgba(60,52,46,.06), 0 1px 3px rgba(60,52,46,.08)' },
    },
  },
  plugins: [],
};
