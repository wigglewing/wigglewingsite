# Intended differences: local rebuild vs live wigglewing.com

The judge passes this list to Claude so it doesn't flag these as regressions.
Edit it when you make a deliberate change. Lines under "Allowed missing copy" are also
used by the deterministic content check: live text that contains any of them may be missing locally.

## Expected changes
- Built from design-system components (ww-split, ww-card, ww-btn, ww-nav, ww-chip, ww-input, ww-banner, ww-footer, ww-madeby) and tokens, so radii, spacing, type sizes and line wraps can shift slightly.
- The nav is sticky with a translucent material background.
- Each page has its own URL (/, /about/, /support/) instead of one URL that swaps views in JavaScript.
- Icons are Lucide SVGs inlined in the page, not Font Awesome. GloveLens uses a golf flag (Lucide has no golfer), GlutenScan wheat, LostPuzzles a puzzle piece.
- App icon grounds use design-system roles: GloveLens is deep moss with a light glyph (the old light moss failed contrast).
- GloveLens links to glovelens.com. GlutenScan and LostPuzzles have no sites yet, so they show a "Coming soon" badge and aren't links (live linked them to "#").
- The footer adds the "Made by WiggleWing" badge, which is required on every site.
- "Privacy" in the footer goes to the privacy FAQ on Support (live linked to "#").
- Support: the app filter uses chips; FAQ answers are native disclosure rows (plus/minus icon).
- Support form posts to the site's Worker (/api/contact) instead of Netlify Forms, and has a Cloudflare Turnstile bot check above the Send button. It validates email inline, shows an error banner if sending fails, and a success toast when it works. "Include device info" sends the browser user agent.
- The focus ring is deep sky (#1f6f99) and the secondary color is moss-deep (#4f6636), both changed in the design system to pass contrast.
- In dark mode, primary buttons are butter (the design system's dark primary) and the illustration placeholder follows the theme (live leaves it light).
- Dark mode follows the system setting until the visitor uses the switch, which is remembered.
- The page renders without JavaScript.

## Allowed missing copy
