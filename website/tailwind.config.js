/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: "#0D0D0D",
        onyx: "#151515",
        graphite: "#1F1F1F",
        ash: "#2A2A2A",
        smoke: "#9A9A9A",
        bone: "#F2EDE6",
        crimson: "#FF3333",
        ember: "#FF6600",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      backgroundImage: {
        "ember-edge": "linear-gradient(135deg, #FF3333 0%, #FF6600 100%)",
      },
      boxShadow: {
        ember: "0 0 0 1px rgba(255, 102, 0, 0.35), 0 0 32px -8px rgba(255, 51, 51, 0.55)",
        "ember-soft": "0 0 24px -10px rgba(255, 102, 0, 0.6)",
      },
    },
  },
  plugins: [],
}
