import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          ink: "#111827",
          mist: "#f3f7f4",
          road: "#2f3437",
          park: "#7aa27b",
          signal: "#f5c542"
        }
      }
    }
  },
  plugins: []
};

export default config;
