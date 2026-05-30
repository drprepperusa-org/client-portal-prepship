# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** PrepShip Client Portal
**Generated:** 2026-05-29 22:13:00
**Category:** Micro SaaS

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable | Tailwind |
|------|-----|--------------|----------|
| Primary (brand blurple) | `#635BFF` | `--brand-rgb` (99 91 255) | `bg-brand` |
| Brand hover | `#5750E6` | `--brand-2-rgb` (87 80 230) | `brand.dark` |
| Brand deep (gradient end) | `#4C46CC` | `--brand-dark-rgb` (76 70 204) | — |
| Brand soft (tint surface) | `#F5F4FF` | `--brand-soft-rgb` (245 244 255) | `bg-brand-bg` |
| Brand bg (active tint) | `#EDEBFE` | `--brand-bg-rgb` (237 235 254) | — |
| Brand border | `#D1CDFC` | `--brand-border-rgb` (209 205 252) | — |
| Ink (primary text) | `#1A1F36` | `--text-1` | `text-ink` |
| Ink-2 (secondary) | `#3C4257` | `--text-2` | — |
| Ink-3 (muted) | `#697386` | `--text-3-rgb` (105 115 134) | — |
| Page background | airy off-white | `--bg` | `bg-surface` |

**Color Notes:** Stripe-style "blurple" accent (`#635BFF`) over an airy off-white
page with white cards, a refined navy ink stack, soft layered shadows, and a
blurple→deep-blurple gradient for primary CTAs. Values are the source-of-truth
tokens defined in `web/src/index.css` (`:root` light + `.dark` lift). Use the
Tailwind/CSS tokens (`bg-brand`, `text-ink`, `bg-brand-bg`, `rgb(var(--brand-rgb))`)
— never hardcode the hex in components.

### Typography

- **Heading & Body Font:** Native system stack — **no custom webfont** (pinned by
  "Boss directive 2026-05-08" in `tailwind.config.ts` to match v2-original feel).
- **Mood:** clean, modern, SaaS, neutral, fast (no font download = instant render)
- **Stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif`
- **Mono (tabular nums):** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- **Font features:** `"cv11", "ss01", "tnum"` (see `web/src/index.css`)

> ⚠️ Do **not** introduce Plus Jakarta Sans or any Google Font — the system stack
> is an intentional product decision. Tailwind `font-display`/`font-sans`/`font-mono`
> all map to the stacks above.

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

Use the Tailwind `shadow-*` utilities (defined in `tailwind.config.ts`):

| Utility | Value | Usage |
|---------|-------|-------|
| `shadow-sm` | `0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04)` | Card/button hover lift |
| `shadow-md` | `0 4px 8px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04)` | Panels, dropdowns |
| `shadow-lg` | `0 8px 24px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.06)` | Modals, popovers |
| `shadow-drawer-l` | `-4px 0 32px rgba(0,0,0,.25)` | Slide-in drawers |

**Radii:** `rounded-btn` (5px) · `rounded-card` (8px) · `rounded-modal` (10px).

**Animations (Tailwind):** `animate-fadeIn` · `animate-fadeInUp` · `animate-slideInRight`
· `animate-bounceIn` · `animate-shimmer` (skeletons) · `animate-spinSlow` (refresh) ·
`animate-pulse`. React components also use framer-motion via
`components/ui/AnimatedWrappers.tsx` (`FadeIn`, `SlideUp`, `StaggeredList/Item`).

---

## Component Specs

### Buttons

Use the shared `<Button>` primitive (`web/src/components/ui/Button.tsx`).
Variants and their token recipes:

```css
/* Primary — blurple gradient */
.btn-primary {
  background: linear-gradient(135deg, rgb(var(--brand-rgb)), rgb(var(--brand-dark-rgb)));
  color: #fff;
  border-radius: 5px;                 /* rounded-btn */
  font-weight: 800;
  transition: all 200ms ease;
  box-shadow: 0 8px 18px rgb(var(--brand-rgb) / .22);
  cursor: pointer;
}
.btn-primary:hover { transform: translateY(-1px); filter: brightness(1.03); }
.btn-primary:active { transform: translateY(0) scale(.985); }

/* Secondary — surface + ring */
.btn-secondary {
  background: rgb(var(--surface-rgb));
  color: rgb(var(--ink-rgb));
  box-shadow: inset 0 0 0 1px rgb(var(--line-rgb));
  border-radius: 5px;
  font-weight: 800;
  cursor: pointer;
}
.btn-secondary:hover { background: rgb(var(--surface-2-rgb)); }

/* Ghost — brand-tinted on hover; Danger — solid danger token */
```

Focus ring everywhere: `focus-visible:outline-2 focus-visible:outline-offset-2
focus-visible:outline-brand/35`. Always `cursor-pointer`, always `motion-reduce:transform-none`.

### Cards

In React, prefer the `<Panel>` / `<StatCard>` primitives in `PortalPrimitives.tsx`.
Recipe (white card on airy page, hairline ring, soft hover lift):

```css
.card {
  background: rgb(var(--surface-rgb));        /* bg-surface */
  border-radius: 8px;                          /* rounded-card */
  padding: 20px;
  box-shadow: inset 0 0 0 1px rgb(var(--line-rgb));  /* ring-1 ring-line */
  transition: transform .2s ease, box-shadow .2s ease;
}

.card:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04);  /* shadow-md */
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: rgb(var(--brand-rgb));
  outline: none;
  box-shadow: 0 0 0 3px rgb(var(--brand-rgb) / .25);
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Refined SaaS (Stripe-inspired) — clean flat base elevated with soft depth

**Keywords:** clean lines, typography-focused, modern, icon-heavy (SVG/Lucide), white cards on airy off-white, blurple accent, soft layered shadows, subtle gradient CTAs

**Best For:** Web apps, SaaS, dashboards, B2B portals, corporate, productivity tools

**Key Effects:** Soft layered shadows (`--shadow-sm/md/lg/xl`), blurple→deep-blurple
gradient on primary CTAs (`linear-gradient(135deg, var(--brand-rgb), var(--brand-dark-rgb))`),
color/opacity hovers (no layout-shifting scale), focus ring `0 0 0 3px rgb(var(--brand-rgb)/.25)`,
clean transitions (150-220ms ease), minimal SVG icons.

### Page Pattern

**Pattern Name:** Minimal & Direct + Demo

- **CTA Placement:** Above fold
- **Section Order:** Hero > Features > CTA

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex onboarding flow
- ❌ Cluttered layout

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
