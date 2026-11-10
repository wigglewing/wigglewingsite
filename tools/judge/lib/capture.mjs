// Loads one page in one configuration and collects what the checks and the LLM judge need.
import AxeBuilder from '@axe-core/playwright';
import { stubTurnstile } from './turnstile-stub.mjs';

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

// Both sides are the page-per-URL rebuild (live since PR #1, 2026-11-08). The theme is remembered in localStorage.
// (The old single-page live site, which needed the #root/ww-site-page handling, is gone.)
const PAGES_SITE = {
  url: (base, page) => base.replace(/\/$/, '') + ({ home: '/', about: '/about/', support: '/support/' }[page]),
  init: (page, theme) => ({ key: 'ww-theme', value: theme }),
  ready: 'main h1',
  async applyTheme() {},
};
export const TARGETS = { live: PAGES_SITE, local: PAGES_SITE };

function pageProbe() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
  };
  const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').replace(/\s+/g, ' ').trim();
  const controls = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=switch],[role=tab]')]
    .filter(visible)
    .filter((el) => !el.closest('.site-visually-hidden'))
    .map((el) => {
      // A checkbox or radio wrapped in its label is hit through the whole label.
      const hit = el.matches('input[type=checkbox],input[type=radio]') && el.closest('label') ? el.closest('label') : el;
      const r = hit.getBoundingClientRect();
      const inText = el.tagName === 'A' && !!el.closest('p,li') && !el.className && el.parentElement.innerText.trim() !== el.innerText.trim();
      return {
        tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', name: name(el),
        href: el.tagName === 'A' ? el.getAttribute('href') : null,
        w: Math.round(r.width), h: Math.round(r.height), inText,
      };
    });
  const lines = document.body.innerText.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const madeby = document.querySelector('footer .ww-madeby');
  return {
    title: document.title,
    lines,
    controls,
    h1Count: document.querySelectorAll('h1').length,
    hiddenButShown: [...document.querySelectorAll('[hidden]')].filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.outerHTML.slice(0, 120)),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bodyFont: getComputedStyle(document.body).fontFamily,
    theme: document.documentElement.dataset.theme || '',
    background: getComputedStyle(document.body).backgroundColor,
    madeby: madeby ? { bg: getComputedStyle(madeby).backgroundColor, color: getComputedStyle(madeby).color, text: madeby.innerText.replace(/\s+/g, ' ').trim() } : null,
    navHTML: document.querySelector('header nav')?.outerHTML.replace(/\s*aria-current="page"/g, '') || '',
    footerHTML: document.querySelector('footer')?.outerHTML || '',
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
    stylesheets: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href),
  };
}

export async function capture(browser, { target, base, page, viewport, theme, axe = false }) {
  const t = TARGETS[target];
  const context = await browser.newContext({ ...VIEWPORTS[viewport], colorScheme: 'light', deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const init = t.init(page, theme);
  await stubTurnstile(context);
  await context.addInitScript(({ key, value }) => { try { if (value) localStorage.setItem(key, value); } catch {} }, init);

  const p = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  p.on('pageerror', (e) => consoleErrors.push(String(e)));
  p.on('requestfailed', (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText})`));
  p.on('response', (r) => r.status() >= 400 && failedRequests.push(`${r.url()} (HTTP ${r.status()})`));

  const url = t.url(base, page);
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await p.waitForSelector(t.ready, { timeout: 30_000 });
  await t.applyTheme(p, theme);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);

  const data = await p.evaluate(pageProbe);
  const png = await p.screenshot({ fullPage: true, animations: 'disabled' });
  let axeResult = null;
  if (axe) {
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    axeResult = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
  }
  await context.close();
  return { target, page, viewport, theme, url, png, ...data, consoleErrors, failedRequests, axe: axeResult };
}

/** Load a page with JavaScript off and report whether its content still renders. */
export async function noJsProbe(browser, url) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const p = await context.newPage();
  await p.goto(url, { waitUntil: 'load' });
  const res = await p.evaluate(() => ({ h1: document.querySelector('h1')?.innerText || '', textLength: document.body.innerText.trim().length }));
  await context.close();
  return res;
}
