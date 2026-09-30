/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#060b16",
          900: "#0b1220",
          850: "#0f172a",
          800: "#16213a",
          700: "#1e2a45",
        },
        accent: {
          DEFAULT: "#38bdf8",
          dim: "#0ea5e9",
        },
      },
      fontFamily: {
        mono: ["Consolas", "Menlo", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
