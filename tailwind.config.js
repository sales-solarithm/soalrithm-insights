/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          gold: '#D4AF37',
          goldLight: '#F0C842',
          goldDark: '#A87A00',
          charcoal: '#121212',
          surface: '#1E1E1E',
          border: '#2C2C2C',
        },
      },
    },
  },
  plugins: [],
};
