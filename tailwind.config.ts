import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        band: {
          excellent: "#16a34a",
          good: "#65a30d",
          poor: "#d97706",
          critical: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};

export default config;
