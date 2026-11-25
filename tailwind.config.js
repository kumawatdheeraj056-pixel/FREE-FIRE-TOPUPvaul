/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './assets/js/**/*.js'],
  theme: {
    extend: {
      /**
       * Colours are authored once as raw OKLCH channels in `--*-raw`
       * (see src/input.css) and consumed here through `<alpha-value>`, so
       * Tailwind's opacity modifiers (`bg-gold/10`, `border-err/35`) actually
       * work. A bare `var(--gold)` would silently ignore the modifier and
       * render a fill at full strength.
       *
       * Channel meaning:
       *   gold  = commerce. CTAs, prices, the thing to touch next.
       *   ember = heat. Atmosphere, glows, dividers — never body text.
       *   gem   = the product. Diamond art, diamond counts, nothing else.
       */
      colors: {
        bg: 'oklch(var(--bg-raw) / <alpha-value>)',
        'bg-elev': 'oklch(var(--bg-elev-raw) / <alpha-value>)',
        surface: 'oklch(var(--surface-raw) / <alpha-value>)',
        'surface-2': 'oklch(var(--surface-2-raw) / <alpha-value>)',
        line: 'oklch(var(--line-raw) / <alpha-value>)',
        'line-strong': 'oklch(var(--line-strong-raw) / <alpha-value>)',
        ink: 'oklch(var(--ink-raw) / <alpha-value>)',
        'ink-muted': 'oklch(var(--ink-muted-raw) / <alpha-value>)',
        'ink-faint': 'oklch(var(--ink-faint-raw) / <alpha-value>)',
        gold: 'oklch(var(--gold-raw) / <alpha-value>)',
        'gold-bright': 'oklch(var(--gold-bright-raw) / <alpha-value>)',
        'gold-deep': 'oklch(var(--gold-deep-raw) / <alpha-value>)',
        'gold-ink': 'oklch(var(--gold-ink-raw) / <alpha-value>)',
        ember: 'oklch(var(--ember-raw) / <alpha-value>)',
        'ember-deep': 'oklch(var(--ember-deep-raw) / <alpha-value>)',
        gem: 'oklch(var(--gem-raw) / <alpha-value>)',
        'gem-bright': 'oklch(var(--gem-bright-raw) / <alpha-value>)',
        'gem-deep': 'oklch(var(--gem-deep-raw) / <alpha-value>)',
        blue: 'oklch(var(--blue-raw) / <alpha-value>)',
        ok: 'oklch(var(--ok-raw) / <alpha-value>)',
        err: 'oklch(var(--err-raw) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        label: ['0.75rem', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '600' }],
        display: ['clamp(2.625rem, 4.2vw + 1.4rem, 5rem)', { lineHeight: '0.98', letterSpacing: '-0.02em' }],
        h2: ['clamp(1.875rem, 1.8vw + 1.35rem, 2.875rem)', { lineHeight: '1.05', letterSpacing: '-0.015em' }],
        h3: ['clamp(1.25rem, 0.6vw + 1.05rem, 1.5rem)', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        ctl: '14px',
        card: '20px',
        panel: '24px',
      },
      maxWidth: {
        shell: '1200px',
        prose: '68ch',
      },
      spacing: {
        section: 'clamp(4.5rem, 9vw, 8rem)',
        step: 'clamp(2rem, 4vw, 3rem)',
      },
      zIndex: {
        sticky: '200',
        nav: '250',
        float: '300',
        backdrop: '400',
        modal: '500',
        toast: '600',
        loader: '700',
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(0 0 0 / 0.5), 0 12px 32px -8px rgb(0 0 0 / 0.6)',
        lift: '0 2px 4px rgb(0 0 0 / 0.5), 0 28px 56px -12px rgb(0 0 0 / 0.75)',
        'glow-gold': '0 0 0 1px var(--gold), 0 0 32px -6px oklch(var(--gold-raw) / 0.5)',
        'glow-gem': '0 0 40px -8px oklch(var(--gem-raw) / 0.55)',
      },
    },
  },
  plugins: [],
};
