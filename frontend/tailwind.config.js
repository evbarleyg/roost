/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Clean, modern, monochrome surfaces with a single sharp iris accent.
        roost: {
          bg: "#f7f7f8", // cool near-white app canvas
          panel: "#ffffff", // cards, drawers, header
          ink: "#18181b", // near-black text (zinc-900)
          muted: "#71717a", // secondary text (zinc-500)
          line: "#eaeaec", // hairline borders
          accent: "#5b5bd6", // iris
          accentSoft: "#eef0fb", // iris wash for active chips
        },
      },
      fontFamily: {
        // Hanken Grotesk: crisp, modern grotesk for UI; JetBrains Mono: tabular figures.
        sans: ["'Hanken Grotesk'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        tightish: "-0.01em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(24,24,27,0.04), 0 1px 1px rgba(24,24,27,0.03)",
        drawer: "-8px 0 30px rgba(24,24,27,0.08)",
      },
    },
  },
  plugins: [],
};
