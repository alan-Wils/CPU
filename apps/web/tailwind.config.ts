import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cpu: {
          bg: "#020617",
          panel: "#0f172a",
          panel2: "#111827",
          border: "#334155",
          text: "#f8fafc",
          muted: "#cbd5e1",
          accent: "#22c55e",
          accent2: "#7c3aed",
          cyan: "#22d3ee",
          warn: "#f59e0b",
          danger: "#ef4444"
        }
      },
      borderRadius: {
        xl2: "14px"
      }
    }
  },
  plugins: []
};

export default config;
