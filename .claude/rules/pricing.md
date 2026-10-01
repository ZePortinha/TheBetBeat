---
paths:
  - "lib/pricing/**"
---

# Pricing rules

- Everything in `lib/pricing` is a PURE function: no I/O, no randomness, no
  clock reads — `now` (epoch ms) is always injected.
- `computeQuote(input, now)` is deterministic and fully tested, including the
  mandatory example of B5.2 and the property-based tests of B5.8 (fast-check).
- Compute sequence (B5.6): calculate → smooth (±15%/min) → clamp to tier limits
  → round (euro below 20 €, multiples of 5 € above) → enforce tier ordering
  (each tier ≥ previous + 5 €) → validate.
- Outputs are never NaN, negative, or outside limits. Quote persistence,
  ids and expiry live in the quote service OUTSIDE lib/pricing.
