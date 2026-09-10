import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/presentation/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // TienDao palette
        gold: "var(--gold)",
        black: "var(--black)",
        paper: "var(--white)",
        "bg-soft": "var(--background-color-1)",
        gray: "var(--gray)",
        "gray-trans": "var(--gray-trans)",
        "title-bg": "var(--title-bg-color)",
        pastel: "var(--pastel)",
        blue: "var(--blue)",
        red: "var(--red)",
      },
      fontFamily: {
        body: ["var(--font-body)"],
        display: ["var(--font-display)"],
        title: ["var(--font-title)"],
        decorative: ["var(--font-decorative)"],
        arthemys: ["var(--font-arthemys)"],
        kd: ["var(--font-kd)"],
        osd: ["var(--font-osd)"],
        sans: ["var(--font-sans)"],
      },
      fontSize: {
        // TienDao uses rem-sized text (root font-size is 10px → 1rem = 10px).
        xxs: ["1.2rem", { lineHeight: "1.5" }],
        xs: ["1.3rem", { lineHeight: "1.6" }],
        sm: ["1.4rem", { lineHeight: "1.7" }],
        base: ["1.6rem", { lineHeight: "1.8" }],
        md: ["1.8rem", { lineHeight: "1.8" }],
        lg: ["2rem", { lineHeight: "1.6" }],
        xl: ["2.4rem", { lineHeight: "1.5" }],
        "2xl": ["2.8rem", { lineHeight: "1.4" }],
      },
      screens: {
        xs: "300px",
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
      },
      borderRadius: {
        card: "1rem",
        pill: "15px",
      },
      boxShadow: {
        card: "0 0 10px var(--gray)",
      },
    },
  },
  plugins: [],
};

export default config;
