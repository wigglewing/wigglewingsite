// Deterministic checks. Each returns findings: { id, status: 'pass'|'warn'|'fail', page?, detail, items? }.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const f = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });

// ---------------------------------------------------------------- content parity
const norm = (s) => s.toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ').trim();

/** Every line of visible text on the live page must appear somewhere on the local page. */
export function contentParity(live, local, allow) {
  const haystack = norm(local.lines.join(' \n '));
  const allowed = (s) => allow.some((a) => norm(s).includes(norm(a)));
  const missing = [...new Set(live.lines)].filter((l) => !haystack.includes(norm(l)) && !allowed(l));
  const localNames = new Set(local.controls.map((c) => norm(c.name)));
  const missingControls = [...new Set(live.controls.map((c) => c.name).filter(Boolean))]
    .filter((n) => !localNames.has(norm(n)) && !haystack.includes(norm(n)) && !allowed(n));
  const out = [];
  out.push(missing.length
    ? f('content.text', 'fail', `${missing.length} line(s) of live copy are missing locally`, { items: missing })
    : f('content.text', 'pass', `All ${live.lines.length} live text lines are present locally`));
  out.push(missingControls.length
    ? f('content.controls', 'fail', `${missingControls.length} live link/button label(s) have no local equivalent`, { items: missingControls })
    : f('content.controls', 'pass', 'Every live link and button label exists locally'));
  if (norm(live.title) !== norm(local.title)) out.push(f('content.title', 'warn', `Title changed: "${live.title}" -> "${local.title}"`));
  return out;
}

// ---------------------------------------------------------------- visual diff
export function pixelDiff(livePng, localPng) {
  const a = PNG.sync.read(livePng);
  const b = PNG.sync.read(localPng);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img) => {
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
    return out;
  };
  const ca = crop(a), cb = crop(b);
  const diff = new PNG({ width, height });
  const changed = pixelmatch(ca.data, cb.data, diff.data, width, height, { threshold: 0.15, includeAA: false });
  return {
    ratio: changed / (width * height),
    heightDelta: b.height - a.height,
    liveSize: [a.width, a.height], localSize: [b.width, b.height],
    diffPng: PNG.sync.write(diff),
  };
}

// ---------------------------------------------------------------- design-system compliance (source)
function walk(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', 'tools', 'design-system'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else if (/\.(html|css|js)$/.test(name)) out.push(p);
  }
  return out;
}

const SPACING_PROPS = /^(margin|padding|gap|row-gap|column-gap|inset|margin-[a-z-]+|padding-[a-z-]+)$/;

export function sourceCompliance(siteRoot, dsPath) {
  const files = walk(siteRoot, siteRoot);
  const components = readFileSync(join(siteRoot, 'design-system/web/css/components.css'), 'utf8');
  const dsClasses = new Set([...components.matchAll(/\.(ww-[a-z0-9_-]+)/g)].map((m) => m[1]));
  const hex = [], rgb = [], fonts = [], spacing = [], timing = [], unknownClasses = [], legacy = [], external = [];

  for (const file of files) {
    const rel = relative(siteRoot, file);
    let src = readFileSync(file, 'utf8');
    // The Made by WiggleWing badge is hard-coded studio colors by design (DS rule), so skip its markup.
    src = src.replace(/<a class="ww-madeby"[\s\S]*?<\/a>/g, '');
    const lineOf = (i) => src.slice(0, i).split('\n').length;
    const css = rel.endsWith('.css') ? src : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style="([^"]*)"/g)].map((m) => m[1] || m[2]).join('\n');

    for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      // In HTML, only flag hex inside style attributes, <style>, or SVG paint attributes.
      if (rel.endsWith('.html')) {
        const ctx = src.slice(Math.max(0, m.index - 40), m.index);
        if (!/(style=|fill=|stroke=|color:|background|<style)/.test(ctx)) continue;
      }
      if (rel.endsWith('.js')) continue;
      hex.push(`${rel}:${lineOf(m.index)} ${m[0]}`);
    }
    for (const m of css.matchAll(/\b(rgba?|hsla?)\(/g)) rgb.push(`${rel} ${m[0]}`);
    for (const m of css.matchAll(/font-family\s*:\s*([^;}"]+)/g)) if (!/var\(--font-/.test(m[1]) && !/inherit/.test(m[1])) fonts.push(`${rel} font-family: ${m[1].trim()}`);
    for (const m of css.matchAll(/(['"])(Bricolage Grotesque|JetBrains Mono|Inter|Manrope|Lexend|Plus Jakarta Sans)\1/g)) fonts.push(`${rel} ${m[0]}`);
    for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;}]+)/g)) {
      const [, prop, value] = m;
      if (SPACING_PROPS.test(prop) && /(^|[\s(])[1-9]\d*(\.\d+)?px/.test(value)) spacing.push(`${rel} ${prop}: ${value.trim()}`);
      if (/^(transition|transition-duration|animation|animation-duration)$/.test(prop) && /\b\d+(\.\d+)?m?s\b/.test(value)) timing.push(`${rel} ${prop}: ${value.trim()}`);
    }
    if (rel.endsWith('.html')) {
      for (const m of src.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('ww-') && !dsClasses.has(c)) unknownClasses.push(`${rel} .${c}`);
      // Cloudflare Turnstile (the contact form's bot check) is the one allowed third-party script.
      for (const m of src.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)) if (!m[1].startsWith('https://challenges.cloudflare.com/turnstile/')) external.push(`${rel} ${m[1]}`);
    }
    for (const m of src.matchAll(/--(ww-ink|ww-chalk|ww-moss|ww-sky|ww-butter|bg-page|fg-1|fg-2|surface-card|border-color|hover-fill)\b/g)) legacy.push(`${rel} --${m[1]}`);
  }

  const list = (id, items, what, status = 'fail') => items.length
    ? f(id, status, `${items.length} ${what}`, { items: [...new Set(items)] })
    : f(id, 'pass', `No ${what}`);
  const out = [
    list('ds.hex', hex, 'hard-coded hex color(s) outside the Made by WiggleWing badge'),
    list('ds.rgb', rgb, 'raw rgb()/hsl() color(s)'),
    list('ds.fonts', fonts, 'hard-coded font name(s)'),
    list('ds.spacing', spacing, 'px spacing value(s) not from var(--space-*)'),
    list('ds.timing', timing, 'hard-coded animation duration(s)'),
    list('ds.classes', unknownClasses, 'ww- class(es) that the design system does not define'),
    list('ds.legacy', legacy, 'legacy token name(s) (--ww-ink, --bg-page …)'),
    list('ds.external', external, 'external script(s) such as icon kits'),
  ];

  // Vendored copy must match the design system repo, when it is available.
  const sync = join(siteRoot, 'tools/sync-ds.mjs');
  if (dsPath && existsSync(join(dsPath, 'package.json'))) {
    try {
      execFileSync(process.execPath, [sync, '--check'], { env: { ...process.env, DS_PATH: dsPath }, stdio: 'pipe' });
      out.push(f('ds.vendored', 'pass', `design-system/ matches ${dsPath}`));
    } catch (e) {
      out.push(f('ds.vendored', 'fail', 'design-system/ is out of date; run node tools/sync-ds.mjs', { items: String(e.stderr).trim().split('\n') }));
    }
  } else out.push(f('ds.vendored', 'warn', `Design system repo not found at ${dsPath}; skipped freshness check`));
  return out;
}

// ---------------------------------------------------------------- design-system compliance (rendered)
const STUDIO_BUTTER = 'rgb(242, 210, 122)';
const STUDIO_INK = 'rgb(28, 42, 34)';

export function runtimeCompliance(cap) {
  const out = [];
  const where = `${cap.page}/${cap.viewport}/${cap.theme}`;
  out.push(cap.madeby && cap.madeby.bg === STUDIO_BUTTER && cap.madeby.color === STUDIO_INK && /made by wigglewing/i.test(cap.madeby.text)
    ? f('ds.madeby', 'pass', `${where}: footer has the Made by WiggleWing badge in studio colors`)
    : f('ds.madeby', 'fail', `${where}: footer Made by WiggleWing badge missing or not in studio colors`, { items: [JSON.stringify(cap.madeby)] }));
  out.push(/^"?Bricolage Grotesque/.test(cap.bodyFont)
    ? f('ds.font-render', 'pass', `${where}: body renders in Bricolage Grotesque`)
    : f('ds.font-render', 'fail', `${where}: body font is ${cap.bodyFont}`));
  out.push(cap.hiddenButShown?.length
    ? f('layout.hidden', 'fail', `${where}: ${cap.hiddenButShown.length} element(s) marked hidden are visible`, { items: cap.hiddenButShown })
    : f('layout.hidden', 'pass', `${where}: hidden elements stay hidden`));
  out.push(cap.h1Count === 1 ? f('a11y.h1', 'pass', `${where}: one h1`) : f('a11y.h1', 'fail', `${where}: ${cap.h1Count} h1 elements`));
  if (cap.viewport === 'mobile') {
    out.push(cap.scrollWidth <= cap.innerWidth
      ? f('layout.no-hscroll', 'pass', `${where}: no horizontal scroll`)
      : f('layout.no-hscroll', 'fail', `${where}: page is ${cap.scrollWidth}px wide in a ${cap.innerWidth}px viewport`));
    const targets = cap.controls.filter((c) => !c.inText);
    const tiny = targets.filter((c) => c.h < 24 || c.w < 24);
    const small = targets.filter((c) => (c.h < 44 || c.w < 44) && !tiny.includes(c));
    const fmt = (c) => `${c.tag}${c.role ? `[${c.role}]` : ''} "${c.name.slice(0, 40)}" ${c.w}×${c.h}`;
    out.push(tiny.length
      ? f('a11y.target-min', 'fail', `${where}: ${tiny.length} control(s) under the 24px WCAG 2.2 minimum`, { items: tiny.map(fmt) })
      : f('a11y.target-min', 'pass', `${where}: every control is at least 24px`));
    if (small.length) out.push(f('a11y.target-44', 'warn', `${where}: ${small.length} control(s) under the 44pt DS touch target`, { items: small.map(fmt) }));
  }
  if (cap.axe) {
    const serious = cap.axe.filter((v) => ['serious', 'critical'].includes(v.impact));
    out.push(serious.length
      ? f('a11y.axe', 'fail', `${where}: ${serious.length} serious/critical axe violation(s)`, { items: serious.map((v) => `${v.id} (${v.nodes}): ${v.help} — ${v.targets.join(', ')}`) })
      : f('a11y.axe', cap.axe.length ? 'warn' : 'pass', `${where}: ${cap.axe.length ? `${cap.axe.length} minor/moderate axe issue(s)` : 'no axe violations'}`, { items: cap.axe.map((v) => `${v.id}: ${v.help}`) }));
  }
  out.push(cap.consoleErrors.length
    ? f('runtime.console', 'fail', `${where}: ${cap.consoleErrors.length} console error(s)`, { items: cap.consoleErrors })
    : f('runtime.console', 'pass', `${where}: no console errors`));
  out.push(cap.failedRequests.length
    ? f('runtime.requests', 'fail', `${where}: ${cap.failedRequests.length} failed request(s)`, { items: cap.failedRequests })
    : f('runtime.requests', 'pass', `${where}: all requests succeeded`));
  if (cap.theme === 'dark') {
    out.push(cap.background !== STUDIO_BUTTER
      ? f('ds.dark', 'pass', `${where}: dark theme applied (background ${cap.background})`)
      : f('ds.dark', 'fail', `${where}: dark theme did not apply`));
  }
  return out;
}

/** Same nav and footer on every page, and every same-site link resolves. */
export async function siteWide(caps, base) {
  const out = [];
  const desktop = caps.filter((c) => c.viewport === 'desktop' && c.theme === 'light');
  const navs = new Set(desktop.map((c) => c.navHTML));
  const footers = new Set(desktop.map((c) => c.footerHTML));
  out.push(navs.size === 1 ? f('site.nav', 'pass', 'Nav markup is identical on every page') : f('site.nav', 'fail', `Nav differs between pages (${navs.size} variants)`));
  out.push(footers.size === 1 ? f('site.footer', 'pass', 'Footer markup is identical on every page') : f('site.footer', 'fail', `Footer differs between pages (${footers.size} variants)`));
  const titles = desktop.map((c) => c.title);
  out.push(new Set(titles).size === titles.length ? f('site.titles', 'pass', 'Every page has its own title') : f('site.titles', 'fail', 'Pages share a title', { items: titles }));

  const hrefs = new Set();
  for (const c of desktop) for (const ctl of c.controls) if (ctl.href) hrefs.add(new URL(ctl.href, c.url).href);
  const broken = [];
  const deadAnchors = [];
  for (const h of hrefs) {
    const u = new URL(h);
    if (u.origin !== new URL(base).origin) continue;
    const res = await fetch(u.origin + u.pathname, { method: 'GET' });
    if (!res.ok) { broken.push(`${u.pathname} (HTTP ${res.status})`); continue; }
    if (u.hash.length > 1) {
      const html = await res.text();
      if (!html.includes(`id="${u.hash.slice(1)}"`)) deadAnchors.push(u.pathname + u.hash);
    }
  }
  for (const c of desktop) for (const ctl of c.controls) if (ctl.href === '#') broken.push(`"${ctl.name}" on ${c.page} links to #`);
  out.push(broken.length ? f('site.links', 'fail', `${broken.length} broken link(s)`, { items: broken }) : f('site.links', 'pass', `All ${hrefs.size} links resolve`));
  if (deadAnchors.length) out.push(f('site.anchors', 'fail', 'Links point at ids that do not exist', { items: deadAnchors }));
  return out;
}
