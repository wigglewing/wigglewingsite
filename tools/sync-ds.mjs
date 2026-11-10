#!/usr/bin/env node
// Copies the WiggleWing design system's web assets into ./design-system/.
// The site vendors these files so the Worker can serve them without a build step.
//
//   node tools/sync-ds.mjs            # from ~/projects/designSystem
//   DS_PATH=/path/to/designSystem node tools/sync-ds.mjs
//   node tools/sync-ds.mjs --check    # exit 1 if the vendored copy is stale
//
// Never edit files under ./design-system/ by hand; change the design system and re-sync.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ds = resolve(process.env.DS_PATH || join(homedir(), 'projects/designSystem'));
const out = join(root, 'design-system');
const check = process.argv.includes('--check');

const APPS = ['glovelens', 'glutenscan', 'lostpuzzles'];
const FILES = [
  'web/css/fonts/wigglewing.css',
  'web/css/brands/wigglewing.css',
  'web/css/components.css',
  // App info pages (/apps/<id>/): every brand scoped by data-brand, plus each app's fonts.
  'web/css/tokens.css',
  ...APPS.map((id) => `web/css/fonts/${id}.css`),
  ...readdirSync(join(ds, 'assets/brands/wigglewing'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => `assets/brands/wigglewing/${f}`),
];

// SVGs ship with a C2PA manifest that is ~10KB each; the site doesn't need it.
const clean = (path, text) => (path.endsWith('.svg') ? text.replace(/<metadata>[\s\S]*?<\/metadata>/g, '') : text);

if (!existsSync(join(ds, 'package.json'))) {
  console.error(`Design system not found at ${ds}. Set DS_PATH.`);
  process.exit(2);
}
const version = JSON.parse(readFileSync(join(ds, 'package.json'), 'utf8')).version;
const stamp = `{\n  "source": "github.com/wigglewing/design-system",\n  "version": "${version}",\n  "files": ${JSON.stringify(FILES, null, 2).replace(/\n/g, '\n  ')}\n}\n`;

const wanted = new Map(FILES.map((f) => [f, clean(f, readFileSync(join(ds, f), 'utf8'))]));
wanted.set('VERSION.json', stamp);

if (check) {
  const stale = [...wanted].filter(([f, text]) => !existsSync(join(out, f)) || readFileSync(join(out, f), 'utf8') !== text);
  if (stale.length) {
    console.error(`design-system/ is out of date with ${ds} (v${version}):\n  ${stale.map(([f]) => f).join('\n  ')}\nRun: node tools/sync-ds.mjs`);
    process.exit(1);
  }
  console.log(`design-system/ matches v${version}`);
  process.exit(0);
}

rmSync(out, { recursive: true, force: true });
for (const [f, text] of wanted) {
  mkdirSync(dirname(join(out, f)), { recursive: true });
  writeFileSync(join(out, f), text);
}
console.log(`Synced ${wanted.size} files from design system v${version} into design-system/`);
