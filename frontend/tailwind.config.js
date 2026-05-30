/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm, calm palette — "Roost" is a nest, not a spreadsheet.
        roost: {
          bg: "#faf8f5",
          panel: "#ffffff",
          ink: "#1f2937",
          muted: "#6b7280",
          line: "#e7e2da",
          accent: "#b45309", // amber-700
          accentSoft: "#fef3c7",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
