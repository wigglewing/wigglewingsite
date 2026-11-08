#!/usr/bin/env node
// Judge: verifies the local wigglewing.com rebuild against the live site.
//
//   node judge.mjs                       # full run (needs Anthropic credentials for the LLM step)
//   node judge.mjs --no-llm              # deterministic checks + screenshots only
//   node judge.mjs --pages home,support  # subset
//   node judge.mjs --live https://deploy-preview-3--wigglewing.netlify.app
//   node judge.mjs --local http://localhost:8888   # judge a running server instead of the repo
//
// Writes tools/judge/out/{report.md,report.json,*.png}. Exit code: 0 pass, 1 fail, 2 incomplete (LLM step skipped or errored).
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { serve } from './lib/server.mjs';
import { capture, noJsProbe } from './lib/capture.mjs';
import { contentParity, pixelDiff, sourceCompliance, runtimeCompliance, siteWide } from './lib/checks.mjs';
import { interactions } from './lib/interactions.mjs';
import { judgePage, makeClient, MODEL } from './lib/llm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '../..');
const { values: args } = parseArgs({
  options: {
    live: { type: 'string', default: 'https://wigglewing.com' },
    local: { type: 'string' },
    pages: { type: 'string', default: 'home,about,support' },
    out: { type: 'string', default: join(here, 'out') },
    'no-llm': { type: 'boolean', default: false },
    'ds-path': { type: 'string', default: process.env.DS_PATH || join(homedir(), 'projects/designSystem') },
  },
});
const PAGES = args.pages.split(',').map((s) => s.trim()).filter(Boolean);
const CAPTURES = [
  { viewport: 'desktop', theme: 'light' },
  { viewport: 'mobile', theme: 'light' },
  { viewport: 'desktop', theme: 'dark' },
];
const expectationsMd = readFileSync(join(here, 'expectations.md'), 'utf8');
const expected = expectationsMd.split('## Allowed missing copy')[0].split('## Expected changes')[1].trim();
const allowMissing = (expectationsMd.split('## Allowed missing copy')[1] || '').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);

rmSync(args.out, { recursive: true, force: true });
mkdirSync(args.out, { recursive: true });
const log = (...m) => console.error('[judge]', ...m);

// Claude's image limit is 8000px per side; keep the top of very long pages.
const fitForLLM = (buf) => {
  const img = PNG.sync.read(buf);
  if (img.height <= 7800) return buf;
  const out = new PNG({ width: img.width, height: 7800 });
  PNG.bitblt(img, out, 0, 0, img.width, 7800, 0, 0);
  return PNG.sync.write(out);
};

const server = args.local ? null : await serve(siteRoot);
const localBase = args.local || server.url;
const browser = await chromium.launch();
const findings = [];
const add = (page, list) => findings.push(...list.map((x) => ({ page, ...x })));

try {
  log(`live ${args.live}  vs  local ${localBase}`);
  add('site', sourceCompliance(siteRoot, args['ds-path']));

  const caps = [];
  const pixel = [];
  for (const page of PAGES) {
    for (const c of CAPTURES) {
      const label = `${c.viewport}/${c.theme}`;
      log(`capturing ${page} ${label}`);
      const [live, local] = await Promise.all([
        capture(browser, { target: 'live', base: args.live, page, ...c }),
        capture(browser, { target: 'local', base: localBase, page, ...c, axe: true }),
      ]);
      const stem = `${page}-${c.viewport}-${c.theme}`;
      writeFileSync(join(args.out, `${stem}-live.png`), live.png);
      writeFileSync(join(args.out, `${stem}-local.png`), local.png);
      const d = pixelDiff(live.png, local.png);
      writeFileSync(join(args.out, `${stem}-diff.png`), d.diffPng);
      pixel.push({ page, capture: label, ratio: Number(d.ratio.toFixed(3)), live: d.liveSize, local: d.localSize });
      if (c.theme === 'light' && c.viewport === 'desktop') add(page, contentParity(live, local, allowMissing));
      add(page, runtimeCompliance(local));
      caps.push({ page, label, live, local, liveAxe: null });
    }
    const nojs = await noJsProbe(browser, caps.find((c) => c.page === page).local.url);
    add(page, [nojs.h1 && nojs.textLength > 200
      ? { id: 'site.no-js', status: 'pass', detail: `Renders without JavaScript ("${nojs.h1}")` }
      : { id: 'site.no-js', status: 'fail', detail: 'Page is empty without JavaScript' }]);
  }
  add('site', await siteWide(caps.map((c) => c.local), localBase));
  if (PAGES.includes('support')) add('support', await interactions(browser, localBase));
  for (const p of pixel) {
    add(p.page, [{ id: 'visual.pixels', status: p.ratio > 0.6 ? 'warn' : 'pass', detail: `${p.capture}: ${(p.ratio * 100).toFixed(1)}% of pixels differ (live ${p.live.join('×')}, local ${p.local.join('×')})` }]);
  }

  // ---- LLM judge
  let verdicts = [];
  let llmStatus = 'skipped (--no-llm)';
  if (!args['no-llm']) {
    try {
      const client = makeClient();
      log(`asking ${MODEL} to judge ${PAGES.length} page(s)…`);
      verdicts = await Promise.all(PAGES.map((page) => judgePage(client, {
        page,
        pairs: caps.filter((c) => c.page === page).map((c) => ({ label: c.label, live: fitForLLM(c.live.png), local: fitForLLM(c.local.png) })),
        findings: findings.filter((x) => x.page === page || x.page === 'site').filter((x) => x.status !== 'pass').map(({ id, status, detail, items }) => ({ id, status, detail, items: items?.slice(0, 15) })),
        expected,
      })));
      llmStatus = 'ran';
    } catch (e) {
      llmStatus = `error: ${e.message}`;
      log(`LLM judge failed: ${e.message}`);
    }
  }

  // ---- report
  const fails = findings.filter((x) => x.status === 'fail');
  const warns = findings.filter((x) => x.status === 'warn');
  const llmFails = verdicts.filter((v) => v.verdict === 'fail');
  const overall = fails.length || llmFails.length ? 'FAIL' : llmStatus === 'ran' ? 'PASS' : 'INCOMPLETE';
  writeFileSync(join(args.out, 'report.json'), JSON.stringify({ overall, live: args.live, local: localBase, llm: llmStatus, model: MODEL, findings, pixel, verdicts }, null, 2));

  const icon = { pass: '✅', warn: '⚠️', fail: '❌' };
  const md = [
    `# Site judge: ${overall}`,
    '',
    `Live \`${args.live}\` vs local \`${args.local || 'repo working tree'}\` · ${new Date().toISOString()}`,
    '',
    `Deterministic: ${fails.length} fail, ${warns.length} warn, ${findings.length - fails.length - warns.length} pass. LLM judge (${MODEL}): ${llmStatus}.`,
    '',
  ];
  if (verdicts.length) {
    md.push('## LLM verdicts', '', '| Page | Verdict | Content | Visual | Design system |', '|---|---|---|---|---|');
    for (const v of verdicts) md.push(`| ${v.page} | ${v.verdict === 'pass' ? '✅ pass' : '❌ fail'} | ${v.scores.content_parity}/10 | ${v.scores.visual_fidelity}/10 | ${v.scores.design_system}/10 |`);
    md.push('');
    for (const v of verdicts) {
      md.push(`### ${v.page}`, '', v.summary, '');
      for (const r of v.regressions) md.push(`- **${r.severity}** (${r.capture}): ${r.description}`);
      if (v.intended_changes_seen.length) md.push('', `<details><summary>Intended changes seen (${v.intended_changes_seen.length})</summary>`, '', ...v.intended_changes_seen.map((s) => `- ${s}`), '', '</details>');
      md.push('');
    }
  }
  md.push('## Checks', '');
  for (const group of ['site', ...PAGES]) {
    const rows = findings.filter((x) => x.page === group).sort((a, b) => ['fail', 'warn', 'pass'].indexOf(a.status) - ['fail', 'warn', 'pass'].indexOf(b.status));
    if (!rows.length) continue;
    md.push(`### ${group}`, '');
    for (const r of rows) {
      md.push(`- ${icon[r.status]} \`${r.id}\` ${r.detail}`);
      if (r.status !== 'pass' && r.items?.length) for (const it of r.items.slice(0, 20)) md.push(`  - ${String(it).replace(/\n/g, ' ')}`);
    }
    md.push('');
  }
  md.push('Screenshots and diffs: `tools/judge/out/<page>-<viewport>-<theme>-{live,local,diff}.png`', '');
  writeFileSync(join(args.out, 'report.md'), md.join('\n'));
  console.log(md.join('\n'));
  process.exitCode = overall === 'FAIL' ? 1 : overall === 'INCOMPLETE' ? 2 : 0;
} finally {
  await browser.close();
  await server?.close();
}
