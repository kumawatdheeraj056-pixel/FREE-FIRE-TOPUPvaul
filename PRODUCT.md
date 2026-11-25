# Product

## Register

brand

Design IS the product here. The page has one job — convert a nervous stranger into a paying
customer in under ninety seconds — and it does that almost entirely through how it looks and
feels. The checkout form inside it is held to product-register craft standards (labels, live
validation, error recovery, keyboard support), but the surface as a whole is a brand surface.

## Users

Free Fire players in India and South/Southeast Asia, typically 15–25, buying in-game currency
for themselves. The physical scene that drives every design decision:

> A player in Ranchi, 11pm, dark room, six-inch Android phone, patchy 4G, about to hand ₹799 to
> a site they found in a YouTube description. They need to believe this is real before they tap
> pay.

Consequences of that scene, in priority order:

1. **Mobile-first is not a slogan.** The primary viewport is 360–414px wide. Desktop is the
   adaptation, not the baseline.
2. **Trust is the conversion bottleneck, not price.** This category is full of scams. Every
   pixel is either building credibility or spending it.
3. **The network is slow.** No render-blocking third-party JS, no megabyte hero video, no
   in-browser CSS compiler.
4. **Ambient light is low.** Dark theme is the correct answer here for a physical reason, not
   because dark looks cool.

The job to be done: *get diamonds into my account, right now, without getting scammed.*

## Product Purpose

A single-page storefront that sells two Free Fire diamond packages. Success is a completed,
correctly-attributed order: right UID, right region, right package, payment captured, diamonds
delivered in 1–5 minutes.

The page must make three things unmissable at all times: **what you're buying**, **what it
costs in total**, and **why you can trust us with the money**.

## Brand Personality

Three words: **assured, exact, quick.**

- *Assured* — the tone of a payment processor, not a hype seller. Statements, not exclamations.
  "Delivery in 1–5 minutes" beats "⚡ SUPER FAST INSTANT DELIVERY!!! 🔥".
- *Exact* — numbers are always shown in full, taxes are never hidden until the last screen, the
  UID is echoed back before payment. Precision is the trust mechanism.
- *Quick* — the interface never makes the user wait for decoration. Motion confirms actions;
  it does not perform.

Emotional goal: the small exhale of relief when a stranger's website turns out to be
legitimate.

## Anti-references

- **Neon cyberpunk gamer sites.** Cyan-on-magenta, angled clip-path panels, Rajdhani/Orbitron
  lettering, animated lightning. Reads as a fan site, not a payment site.
- **Grey-market top-up pages.** Wall of packages, blinking "LIMITED OFFER" banners, WhatsApp
  numbers in three colors, countdown timers that reset on reload. Every one of these is a
  trust withdrawal.
- **Generic SaaS landing template.** Hero metric row, three identical icon cards, purple
  gradient, "Trusted by 10,000+ teams".
- **Crypto-luxury gold.** Embossed 3D gold text, marble textures, lens flare. Gold must read as
  brushed metal, not as treasure.
- **Any use of the official Garena / Free Fire logo or artwork.** This is an independent
  reseller. Borrowing first-party brand assets is exactly what a scam site does.

## Design Principles

1. **The total is never more than one glance away.** On every viewport, at every scroll
   position, the user can see what they will actually be charged. This is the single most
   important anti-scam signal a checkout can send.

2. **Trust is shown, not claimed.** A padlock emoji is a claim. Echoing the UID back before
   payment, spelling out the tax line, naming the refund window, and stating what we will
   *never* ask for — those are demonstrations. Prefer demonstrations.

3. **Every step is reversible until money moves.** Package, UID, region, payment method can all
   be changed at any point. The confirmation modal is the only one-way door, and it summarises
   everything before it opens.

4. **Restraint is the luxury signal.** Gold is an accent that appears on roughly one element
   per viewport, never a fill. The moment the page glows everywhere, it reads cheap. Spend the
   gold on the thing the user should touch next.

5. **Nothing important depends on JavaScript succeeding.** Prices, policies, contact routes and
   trust copy are in the HTML. JS adds validation, motion and the checkout flow — it does not
   gate the content.

## Accessibility & Inclusion

- **Target: WCAG 2.2 AA.**
- All body text ≥ 4.5:1 against its own background; large text ≥ 3:1. Placeholder text is held
  to the body-text ratio, not the usual washed-out grey.
- Package and payment selectors are real `<input type="radio">` groups — arrow-key navigation
  and screen-reader semantics come free.
- Every interactive element has a visible `:focus-visible` ring that is not colour-only.
- Validation state is conveyed by icon + text + colour, never colour alone (relevant for the
  large red/green colour-blind population in the target demographic).
- `prefers-reduced-motion: reduce` disables the particle field, all entrance animations and all
  transforms, leaving instant state changes.
- Minimum touch target 44×44px throughout; primary CTAs are 52px+.
- The page is fully operable by keyboard, including the confirmation dialog (native
  `<dialog>` + `showModal()` for a real focus trap) and the FAQ accordion.
