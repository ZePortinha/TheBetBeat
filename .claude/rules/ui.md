---
paths:
  - "app/**"
  - "components/**"
---

# UI rules

Use the `apple-design` skill for anything that moves or is touched.

- Colors/typography/spacing: ONLY design tokens (`styles/tokens.css` via
  Tailwind). No raw hex values in components.
- All UI strings come from `messages/*.json` (next-intl) — never hardcoded.
  pt-PT everywhere; EN too on the guest app.
- Touch targets ≥ 44px (guest) / 56px (cockpit); ~10px hit slop; press feedback
  on pointer-down (scale 0.97, 100ms); drag-away cancels.
- Interaction checklist (B10.6) applies to every screen: immediate response,
  zero artificial latency, interruptible animations, 1:1 gestures with pointer
  capture, physics on release (velocity handoff + momentum projection 0.998),
  rubber-banding at bounds, spatial consistency (enter/exit same path,
  transform-origin from trigger), only transform/opacity animated, no loops
  except live indicators, nothing > 600ms on the critical path.
- Springs from `lib/motion.ts` only (`springDefault`, `springMove`,
  `springSheet`, `springMomentum`); bounce only after a gesture with momentum.
  Tweens only for opacity/color.
- Respect `prefers-reduced-motion` (short cross-fades, static Beat Pulse),
  `prefers-reduced-transparency` (solid surfaces, no blur) and
  `prefers-contrast: more` (solid + defined border).
- Prices/times/BPM use tabular numerals (`.tnum`). Text ≥ AA; prices & CTAs ≥ AAA.
  Color is never the only signal (chips have icon + text).
- Forbidden words in UI: "aposta", "apostar", "odds", "ganhar".
