# Migration log

- 2026-11-08: Plan and state created. Blocked on cf login and the Namecheap domain list.
- 2026-11-08: Inventory done for wigglewing.com and glovelens.com (records/*.json). Both move to `zone`, blocked on cf login. Flagged glovelens apex SES MX and missing wigglewing DMARC.
- 2026-11-08: cf login confirmed. Created zones wigglewing.com (b75ece…) and glovelens.com (7e4f2a…), both pending, nameservers iris/joaquin.ns.cloudflare.com. Imported all records DNS-only; dig against Cloudflare matches the current nameservers for every record. wigglewing apex/www are flattened CNAMEs to fabulous-cranachan-4130af.netlify.app; glovelens keeps Netlify's A records (site name unknown). Corrected wigglewing rollback NS to p03 (registry). Both now waiting at G1.
- 2026-11-08: User confirmed Namecheap domains: blairadventures.com, glovelens.com, wigglewing.com. Created blairadventures.com zone (934cce…), imported 16 records, all match. Its CMS host content.blairadventures.com has no DNS (pre-existing breakage). It goes last since it carries the user's main inbox.
- 2026-11-08: User approved and switched wigglewing.com nameservers at Namecheap. .com registry now delegates to Cloudflare. Ran the activation check; zone still pending.
- 2026-11-08 17:51Z: wigglewing.com zone ACTIVE on Cloudflare. Checks: site 200, TLS valid, www→apex 301, MX/SPF/DKIM resolve via 8.8.8.8 from Cloudflare. 24h soak started.
- 2026-11-08: User deferred registrar transfers (G4) for all three domains until later.
- 2026-11-08: User approved glovelens.com G1 early (before wigglewing soak ends). Rechecked: all 8 record sets in Cloudflare still match.
- 2026-11-08: User switched glovelens.com nameservers at Namecheap; registry not yet updated. Activation watcher running.
- 2026-11-08 17:55Z: glovelens.com ACTIVE on Cloudflare; site 200, TLS ok, www 301, 3 MX via 8.8.8.8. Soak started.
- 2026-11-08: blairadventures.com preflight: no DNSSEC DS on any domain; probed ~60 extra subdomains, nothing new. Waiting on Netlify panel record list.
- 2026-11-08: blairadventures.com checked against the Netlify export (21 records). Added 5 missing content.* records (DKIM + 4 cal/card TXT). Replaced apex/www A records with DNS-only CNAMEs to blairadventures.netlify.app. All 18 record sets match. Ready for G1.
- 2026-11-08: User approved and switched blairadventures.com nameservers at Namecheap.
- 2026-11-08 18:05Z: blairadventures.com ACTIVE on Cloudflare. MX, SPF, DMARC, DKIM (default + fm1-3 via fmhosted) and cal/card records correct via 8.8.8.8, 1.1.1.1, 9.9.9.9. Site 200, TLS ok, www 301. 48h soak; Netlify DNS zone stays until 2026-11-10T18:05Z. Waiting on user mail tests.
- 2026-11-08: User confirmed blairadventures.com mail works both directions after the switch.
- 2026-11-08 18:08Z: Gmail headers for a message from chris@: spf=pass, dkim=pass (fm1), dmarc=pass (p=QUARANTINE). Mail authentication verified after the switch.

## 2026-11-08 18:40Z wigglewing.com: host step
- Contact form leaves Netlify Forms. Recipient: hello@wigglewing.com (user).
- Created Turnstile widget 0x4AAAAAAF498_Cz6v1td1ih (managed) and D1 database wigglewing-contact.
- Added wrangler.jsonc, worker/index.js (POST /api/contact: honeypot, email check, Turnstile siteverify, insert into D1, then email via send_email binding; the row records emailed/email_error), migrations/0001_messages.sql, .assetsignore (tools, ops, worker and config are not published).
- support/index.html: form action /api/contact, Turnstile widget; js/site.js posts JSON-accepting and resets the widget.
- Judge: live target now the rebuilt site (PR #1 is live); Turnstile stubbed in captures; Turnstile script allowed in ds.external.
- Local wrangler dev: valid post stored and emailed (simulated); no token -> 403 bot-check-failed; bad email -> 400; honeypot -> silent 200; no-JS -> 303 back to /support/.
- Deployed wigglewing-site to https://wigglewing-site.wigglewingsite.workers.dev, set TURNSTILE_SECRET, applied D1 migration remotely. Fake token rejected. Judge --local workers.dev: PASS.
- Blocked: Email Sending API returns 401 (account on Workers Free; sending is Workers Paid). Email Routing would need the apex MX, which Fastmail owns. Asked the user.

## 2026-11-08 18:35Z wigglewing.com: email sending
- User upgraded to Workers Paid. Enabled Email Sending for wigglewing.com (sending id 9f2b6cea95434e73ac6f3670a1cc7b02).
- Cloudflare auto-created cf-bounce MX x3, SPF, cf-bounce._domainkey DKIM (read-only) and _dmarc p=reject. Apex MX (Fastmail) unchanged, verified by dig.
- Kept one DMARC record: v=DMARC1; p=quarantine; (deleted Cloudflare's p=reject duplicate; two DMARC records would void both). Sending DNS status: ready.
- Test email forms@wigglewing.com -> hello@wigglewing.com: queued.
- Next: user submits the real form on workers.dev (Turnstile needs a person) and confirms delivery; then G2.

## 2026-11-08 18:47Z wigglewing.com: G2 cutover (approved by user in chat)
- User's form test on workers.dev: D1 row 1, emailed=1, arrived at hello@.
- Worker now runs first on every request and 301s www to the apex.
- Deleted the apex and www CNAMEs to fabulous-cranachan-4130af.netlify.app; wrangler deploy attached wigglewing.com and www.wigglewing.com as Worker custom domains.
- A few edges returned 522 for about a minute while propagating, then cleared. Turned on Always Use HTTPS (http -> 301 https).
- Checks: /, /about/, /support/ 200; www 301 to apex; /wrangler.jsonc 404; fake Turnstile token -> bot-check-failed; MX still Fastmail.
