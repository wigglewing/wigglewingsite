# Cloudflare consolidation

Goal: every WiggleWing domain registered, resolved and hosted on Cloudflare. Namecheap and Netlify are retired.
Mail stays on Fastmail; only its DNS records move. Contact forms move to a Worker that checks Turnstile, saves to D1 and emails a verified Fastmail address.

`state.json` is the source of truth. The `/loop` reads it each tick, does the next unblocked step, writes it back, and appends to `LOG.md`.

## The graph (per domain)

```
inventory ──► zone ──► [G1 nameservers] ──► dns-active ──┬─► host ──► [G2 cutover] ──► live ──► [G3 retire netlify]
                                                          │
                                                          └─► (wait ≥ 60 days since last transfer/registration) ──► [G4 registrar transfer] ──► done
```

`[Gn]` marks a gate. A gate step never runs until `approvals` in state.json contains `"<domain>:<gate>"`, or the user approves in chat (then record it there).

| Step | What happens | Done when |
|---|---|---|
| inventory | Export every DNS record (Netlify DNS zone / `dig` across known names) into `records/<domain>.json`. Note the host (Netlify site id), forms, redirects, mail (MX, SPF, DKIM, DMARC, SES). | File written, nothing unexplained |
| zone | `cf` creates the zone (free plan), imports the records. Site records stay **DNS-only (grey)** and keep pointing at Netlify so nothing changes yet. | `dig @<cf-ns>` matches the inventory record for record |
| G1 nameservers | Switch nameservers at Namecheap to the Cloudflare pair. User does it in the Namecheap UI unless API access is set up. | Cloudflare reports zone `active`; public `dig NS` shows Cloudflare |
| dns-active | Verify the site loads, mail MX/SPF/DKIM resolve, TLS is valid. Then delete the Netlify DNS zone so Netlify stops answering. | All checks green for 24h |
| host | Port the site to a Worker with static assets (`wrangler.jsonc` in the site repo). Forms: a Worker route that verifies Turnstile, inserts into D1, sends email. Deploy to `*.workers.dev`. Run the judge with `--local <workers.dev url>` against the live site. | Judge PASS, a form test lands in D1 and the inbox |
| G2 cutover | Attach the custom domain to the Worker (replaces the Netlify A/CNAME). | Judge PASS against the real domain |
| live | Watch for 48h: errors, form deliveries. | Quiet |
| G3 retire netlify | Delete the Netlify site, disconnect the repo. | Done |
| G4 registrar transfer | Unlock at Namecheap, get the EPP code (user), start the transfer in Cloudflare (costs one year of renewal, at cost). Approve the transfer email. | Cloudflare shows registrar = Cloudflare |

## Rules for the loop
- Order through G1: wigglewing.com (pilot), then glovelens.com, then blairadventures.com last (it carries the main personal inbox). Each waits for the previous to pass `dns-active`.
- Never change nameservers, production routing, Netlify sites or registrations without the gate approval.
- Never commit secrets. The Turnstile secret, the email sending token and any Namecheap/Netlify tokens live in Worker secrets or env vars only.
- Cloudflare: use the `cf` CLI; inside a repo with a `wrangler.jsonc`, use wrangler.
- When blocked on the user, say exactly what's needed in `blocked_on`, notify once, and back off (long sleeps) until it changes.
- Rollback for any DNS step: switch nameservers back to Netlify's NS1 pair (recorded in state.json).
