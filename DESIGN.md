# Design

## Theme

**Cinematic battlefield-dark, lit by fire.** Near-black surfaces tinted toward ember
(#0B0B0B / #151515), gold `#F7B500` as the commerce accent, ember orange `#FF7A00` as heat,
and the blue brilliant-cut diamond — the shape and colour every Free Fire player already knows
as the in-game currency — as the product's own colour channel.

The reference stack:

- **AAA game-store pages (PlayStation Store, Riot, CoD promos)** — for the structure: one
  dominant idea per fold, cinematic atmosphere layers, merchandising surfaces instead of web
  cards.
- **Stripe Checkout** — for the form craft: total pinned in view, tax broken out, UID echoed
  back, no surprise at the end. The page looks like a game; the checkout behaves like a bank.

Identity constraints that make it *this* brand and not a template:

- **No first-party Garena assets, ever.** All artwork is original in-repo SVG. The footer
  states plainly that this is an independent reseller. Looking premium is the goal;
  impersonating the publisher is the failure mode (and what scam sites do).
- Fire tones stay warm gold/orange — never cyan-magenta RGB-gamer neon.
- Trust copy ("we never ask for your password") survives every redesign untouched. It is the
  conversion engine; the cinematics only buy it attention.

### Colour strategy

**Committed.** Three channels, each with a fixed meaning, so colour carries information:

- **gold = commerce.** CTAs, prices, the selected state, the thing to touch next.
- **ember = heat.** Atmosphere, glows, particles, dividers. Never body text, never a control.
- **gem (blue, #1FA9FF) = the product.** Diamond artwork and diamond counts. Nothing else is
  ever that blue, which is exactly why the product reads instantly.

Blue survives only as a minor info accent (Discord, net-banking glyphs). Green/red remain
valid/error.

### Tokens

All colour authored in **OKLCH**; raw channels (`--*-raw`) feed Tailwind so opacity modifiers
work. Neutrals tinted toward the ember hue (~60), the temperature of a dark room lit by
something burning off-screen.

| Token | Value | Role |
|---|---|---|
| `--bg` | `oklch(0.15 0.006 60)` | Page background (≈ #0B0B0B) |
| `--bg-elev` | `oklch(0.196 0.008 60)` | Raised bands, footer (≈ #151515) |
| `--surface` | `oklch(0.232 0.009 60)` | Cards, inputs |
| `--surface-2` | `oklch(0.278 0.011 62)` | Hover, nested chips |
| `--line` / `--line-strong` | `0.33 / 0.42` L | Hairline / emphasised borders |
| `--ink` | `oklch(0.975 0.004 80)` | Primary text |
| `--ink-muted` | `oklch(0.8 0.008 75)` | Secondary text |
| `--ink-faint` | `oklch(0.7 0.01 70)` | Tertiary + placeholders — ≥4.5:1 on `--surface` |
| `--gold` | `oklch(0.813 0.167 82)` | #F7B500 — commerce |
| `--gold-bright` / `--gold-deep` | — | Gradient ends, sheen |
| `--ember` | `oklch(0.723 0.19 50.5)` | #FF7A00 — heat, glows |
| `--gem` | `oklch(0.707 0.166 243.7)` | The diamond blue (#1FA9FF) |
| `--gem-bright` / `--gem-deep` | — | Facet highlights / pavilion depths |
| `--ok` / `--err` | — | Valid / error |

## Typography

- **Display — Space Grotesk 500–700.** Section headings and the hero run uppercase: squared,
  techy terminals that read as game-UI chrome without costume fonts. Tracking −0.015 to −0.02em.
- **UI / body — Inter 400–700**, `tabular-nums` locked on every currency figure and the UID.

Scale: `display` `clamp(2.625rem, 4.2vw + 1.4rem, 5rem)` / `h2` to `2.875rem` / body 1rem/1.65.
`text-wrap: balance` on headings, `pretty` on prose.

## Imagery — supplied artwork + in-repo SVG

- **The gem.** The real diamond artwork lives in `assets/diamonds/`: `diamond.png` (880px,
  cut from the supplied render with a feathered convex-silhouette mask; used in the hero with
  halo, masked light sweep, twinkles and orbiting stones) and `diamond-sm.png` (240px; the
  package-card illustrations — single stone for 500, three-stone cluster for 1000). The 24px
  `#i-gem` sprite icon (logo, buttons, summary rows, prices) is original SVG matched to the
  same blues, so every scale reads as one currency.
- **Promo tiles.** `character.webp` and `crate.jpg` (supplied, carry the official Free Fire
  wordmark — a deliberate owner decision that cuts against the no-first-party-assets rule in
  PRODUCT.md; the independent-reseller disclaimer in the footer is the counterweight) as
  cover images in the two store-style tiles between How-it-works and the FAQ, with dark
  scrims, hover zoom, and CTAs into the checkout.
- **Battlefield skyline** (`#art-skyline`): ruined blocks, a comms tower, a drop-plane with a
  dashed descent path. Two parallax layers at the hero's feet, one dim echo above the footer.
  Silhouette-only, low contrast — atmosphere, not clutter.
- **Ember canvas.** Rising sparks (gold/ember, ~12% gem pink) with sway and flicker,
  pre-rendered glow sprites, DPR capped at 2, paused off-screen/hidden, absent under
  reduced-motion.
- **Smoke.** Three pre-blurred drifting masses (ember, gem, gold tints), transform-only.
- Film-grain noise overlay (inline SVG turbulence, 5% opacity, one fixed layer).
- Payment glyphs, trust and step icons: original inline SVG on a 24px grid.

## Components

- **Package card** — the merchandising centrepiece. Gem illustration on top, diamond count in
  display type with a small gem icon, gold price. Hover: pointer tilt (fine pointers only).
  Selected: rotating gold/ember conic ring (`@property --spin`; static ring fallback), glow
  pulse, gold checkmark pop, and a one-shot spark burst.
- **Buttons** — primary is gold→ember gradient with `--gold-ink` text, diagonal sheen sweep on
  hover, magnetic lean on fine pointers (`data-mag`). Ghost: hairline outline, gold hover.
- **Inputs** — 58px, `--bg-elev` fill, gold caret; focus lifts to `--surface` with a gold ring
  and outer glow. Valid: green border + inline tick. Invalid on submit: shake + red ring +
  message. The UID field carries a player-ID icon.
- **Order summary** — glass rail with a lit gold top edge, gem icon in the diamonds row,
  odometer-rolling total, delivery badge, pulsing "encrypted checkout" badge. Mobile: bottom
  glass total bar that expands upward (unchanged — still the most important responsive
  decision on the page).
- **Step markers & icon frames** — rotated squares (the diamond motif carried into the chrome),
  content counter-rotated. Step badges fill gold as each step completes.
- **Timeline (How it works)** — four connected nodes: vertical rail on mobile, horizontal at
  `lg`. The gold→ember fill draws in when the section enters view; nodes pop in staggered; the
  final node is gem-pink. Replaces the old three-box grid.
- **Section dividers** — angled `clip-path` slashes into elevated bands, plus a glowing
  gold→ember hairline (`.ember-line`) under the hero.
- **Glass** stays reserved for things that truly float: navbar, summary rail, mobile bar,
  chips, modal, toasts.
- Radii 14/20/24, layered dark shadows, gold glow only on selection + primary hover.

## Motion

Fifteen systems, all transform/opacity, all gated:

load: loader (≤1.4s, session-once, CSS kill-switch at 2.8s) → staggered hero rise. Ambient:
embers, smoke drift, gem float + 7s facet light sweep, twinkles, orbiting stones. Pointer
(fine-pointer only): hero layer parallax (lerped rAF that sleeps when settled), package-card
tilt, magnetic CTAs, trailing cursor glow. Scroll: reveals (visible-by-default + 2s failsafe),
timeline draw, metric count-ups, navbar shadow. Feedback: selection ring spin + burst, checkmark
pop, total odometer, UID tick/shake, accordion, toasts, modal.

Easing `cubic-bezier(0.16, 1, 0.3, 1)` everywhere; 150ms feedback / 400–600ms reveals / 700ms
hero. `prefers-reduced-motion` collapses every one of these to instant state changes and
removes the canvas, smoke, loader and cursor glow entirely.

### Scroll-performance budget (learned the hard way)

- `transform-style: preserve-3d` on the package cards makes Chrome composite text behind the
  card background — the tilt works fine without it.
- `content-visibility: auto` on tall sections caused scroll-position jumps; dropped.
- Backdrop blur is capped at **10px** and the sticky order-summary rail is **opaque**, not
  glass — a sticky backdrop-filter surface re-blurs everything beneath it on every scrolled
  frame.
- The selected-card pulse animates the **opacity of a pre-painted shadow** on a
  pseudo-element, never `box-shadow` itself (which repaints the card per frame).
- No blur/drop-shadow filters on animated subtrees (the hero artwork carries its own baked
  glow); smoke masses are capped at 56px blur; all hero ambience pauses via
  `#hero[data-idle]` when the hero scrolls out of view.

## Layout

Unchanged skeleton from the previous iteration (it was right): mobile-first single column to
1023px; checkout splits 1.55fr/1fr at `lg` with the sticky summary rail; content max 1200px;
prose 68ch; semantic z-scale base→sticky→nav→float→backdrop→modal→toast→loader. Section rhythm
`clamp(4.5rem, 9vw, 8rem)`, tightened between checkout steps.
