# wigglewing.com

Static site for the WiggleWing studio, built on the [WiggleWing design system](https://github.com/wigglewing/design-system). A Cloudflare Worker serves the repo root as static assets (no build step) and handles the contact form. Netlify served it until the Cloudflare cutover.

```
index.html            Apps (home)
about/index.html      About
support/index.html    Support: FAQ + contact form (posts to /api/contact, Turnstile bot check)
css/site.css          Page layout only. Tokens and components come from the design system.
js/site.js            Optional enhancements: dark-mode switch, FAQ filter, form validation/submit
design-system/        Vendored from the design system. Generated, do not edit.
tools/sync-ds.mjs     Refreshes design-system/ from ~/projects/designSystem (or DS_PATH)
tools/judge/          Compares this working tree with the live site
worker/index.js       POST /api/contact: Turnstile check, save to D1, email hello@wigglewing.com
migrations/           D1 schema (database wigglewing-contact)
wrangler.jsonc        Worker config. .assetsignore keeps tooling out of the published files
```

## Rules
- Use `ww-` classes from `design-system/web/css/components.css` and `var(--color-*)`, `var(--space-*)` and the other tokens. No raw hex, font names, px spacing or durations in site code. Page-specific classes use the `site-` prefix.
- Every page keeps the identical nav and footer, including the Made by WiggleWing badge.
- Pages must work without JavaScript.

## Cloudflare Worker
```sh
npx wrangler dev                                   # local site + form API
npx wrangler d1 migrations apply wigglewing-contact --remote
npx wrangler secret put TURNSTILE_SECRET           # once; never commit it
npx wrangler deploy
npx wrangler d1 execute wigglewing-contact --remote --command "SELECT * FROM messages ORDER BY id DESC LIMIT 20"
```
Every message is saved in D1 even if the email fails (`emailed = 0`, `email_error` says why).

## Updating the design system
```sh
node tools/sync-ds.mjs           # copy the latest web CSS + logos
node tools/sync-ds.mjs --check   # fails if design-system/ is stale
```

## Judge: local vs live
```sh
cd tools/judge
npm install && npx playwright install chromium   # once
npm run judge          # full run; Claude judges via your Claude Code login (`claude -p`)
npm run judge -- --llm api   # use ANTHROPIC_API_KEY instead (auto-picked when the key is set)
npm run judge:fast     # deterministic checks + screenshots only
node judge.mjs --live https://deploy-preview-N--<site>.netlify.app --pages support
```
It writes `tools/judge/out/report.md`, `report.json`, and live/local/diff screenshots for each page at desktop, mobile and dark.

Checks:
- **Content parity:** every line of live copy and every live link/button label still exists locally.
- **Visual:** pixel diff per capture, plus Claude (`claude-opus-5-5`) comparing live and local screenshots, which returns a structured verdict per page. Intended changes are listed in `tools/judge/expectations.md`, so update that file when you change something on purpose.
- **Design system:** no raw colors, font names, px spacing or durations; only real `ww-` classes; no legacy tokens or icon kits; vendored copy up to date; Made by WiggleWing badge in studio colors; Bricolage renders; dark theme applies.
- **Accessibility & behavior:** axe (WCAG 2.2 AA), touch targets (24px fail, 44pt warn), one h1, no horizontal scroll, hidden stays hidden, console/network errors, broken links/anchors, renders without JS, plus the FAQ filter, disclosure, form validation, send/fail paths and dark-mode persistence.

Exit code: 0 pass, 1 fail, 2 incomplete (Claude step skipped or errored).
