const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Colors are CSS variables (see globals.css) so high-contrast mode can swap the whole palette.
      colors: {
        void: token("void"),
        ink: token("ink"),
        mist: token("mist"),
        dim: token("dim"),
        warn: token("warn"),
        panel: token("panel"),
        neon: {
          cyan: token("neon-cyan"),
          blue: token("neon-blue"),
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "neon-edge": "linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)",
      },
      boxShadow: {
        neon: "0 0 0 1px rgba(0, 242, 254, 0.35), 0 0 28px -6px rgba(0, 242, 254, 0.45)",
        "neon-soft": "0 0 20px -8px rgba(79, 172, 254, 0.6)",
      },
    },
  },
  plugins: [],
}
