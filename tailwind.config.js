/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'Assistant', 'Arial', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef6fb',
          100: '#d7e9f5',
          600: '#1b5e8a',
          700: '#154b6f',
          800: '#103a56',
          900: '#0c2b40',
        },
      },
    },
  },
  plugins: [],
};
