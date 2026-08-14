/**
 * Colour reaches components only through the CSS variables declared in
 * src/index.css, so every hue has one definition and both themes stay in step.
 * `<alpha-value>` keeps Tailwind's opacity modifiers (bg-brand/10) working.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'Assistant', 'Arial', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: token('paper'),
        surface: {
          DEFAULT: token('surface'),
          2: token('surface-2'),
          sunken: token('surface-sunken'),
        },
        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
          3: token('ink-3'),
        },
        rule: {
          DEFAULT: token('rule'),
          strong: token('rule-strong'),
        },
        brand: {
          DEFAULT: token('brand'),
          ink: token('brand-ink'),
          soft: token('brand-soft'),
          hover: token('brand-hover'),
        },
        state: {
          final: token('state-final'),
          'final-soft': token('state-final-soft'),
          partial: token('state-partial'),
          'partial-soft': token('state-partial-soft'),
          estimate: token('state-estimate'),
          'estimate-soft': token('state-estimate-soft'),
          missing: token('state-missing'),
          'missing-soft': token('state-missing-soft'),
        },
        up: token('up'),
        down: token('down'),
        warm: {
          DEFAULT: token('accent-warm'),
          soft: token('accent-warm-soft'),
        },
      },
    },
  },
  plugins: [],
};
