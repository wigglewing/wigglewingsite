// LLM judge: Claude compares live vs local screenshots for one page, given the deterministic findings.
// Two backends:
//   api         - Anthropic SDK, needs ANTHROPIC_API_KEY (or `ant auth login`).
//   claude-code - runs `claude -p` headless, so it uses your Claude Code login (subscription).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const MODEL = process.env.JUDGE_MODEL || 'claude-opus-5-5';

const Verdict = z.object({
  page: z.string(),
  verdict: z.enum(['pass', 'fail']).describe('fail if any blocker or major regression exists'),
  scores: z.object({
    content_parity: z.number().describe('0-10: is everything a visitor could read or do on live still there?'),
    visual_fidelity: z.number().describe('0-10: does it still look like the same studio site, ignoring intended changes?'),
    design_system: z.number().describe('0-10: does it look built from the WiggleWing design system?'),
  }),
  regressions: z.array(z.object({
    severity: z.enum(['blocker', 'major', 'minor']),
    capture: z.string().describe('which capture, e.g. "desktop/light"'),
    description: z.string(),
  })),
  intended_changes_seen: z.array(z.string()).describe('differences that match the expected-changes list'),
  summary: z.string().describe('two or three sentences'),
});

const SYSTEM = `You are a meticulous visual QA reviewer for wigglewing.com, an indie mobile studio's website.
The site was rebuilt from a JavaScript-only bundle into static HTML that uses the shared WiggleWing design system (ww- CSS components and tokens).
You receive, for one page, screenshot pairs of the LIVE site (the reference) and the LOCAL rebuild in several captures (viewport/theme), plus a JSON summary of automated checks.

Your job: decide whether the local rebuild can replace the live page.
- A regression is anything a visitor would notice as worse or missing: lost copy, broken or missing sections, misaligned or overlapping layout, unreadable text, wrong brand colors, broken images or icons, poor contrast, clipped content, mobile layout problems, a broken dark mode.
- Differences listed in EXPECTED CHANGES are intentional. Do not count them as regressions; list the ones you saw under intended_changes_seen.
- Small shifts in spacing, radius, type size or line wrapping that come from adopting design-system tokens are intended unless they hurt readability or hierarchy.
- Use the automated findings as evidence, but judge the screenshots yourself; the pixel-diff ratio is expected to be high because of intended changes.
Severity: blocker = must not ship; major = clearly worse than live; minor = polish.`;

/**
 * @param {{page: string, pairs: {label: string, live: Buffer, local: Buffer}[], findings: object[], expected: string}} input
 */
export async function judgePage(client, { page, pairs, findings, expected }) {
  const content = [];
  for (const { label, live, local } of pairs) {
    content.push({ type: 'text', text: `Capture ${label} — LIVE (reference):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: live.toString('base64') } });
    content.push({ type: 'text', text: `Capture ${label} — LOCAL (rebuild):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: local.toString('base64') } });
  }
  content.push({ type: 'text', text: `EXPECTED CHANGES:\n${expected}\n\nAUTOMATED FINDINGS for page "${page}":\n${JSON.stringify(findings, null, 1)}\n\nReturn your verdict for page "${page}".` });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: betaZodOutputFormat(Verdict) },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`Claude declined to judge "${page}" (${response.stop_details?.category ?? 'no category'})`);
  if (!response.parsed_output) throw new Error(`No structured verdict for "${page}" (stop_reason ${response.stop_reason})`);
  return { ...response.parsed_output, model: response.model, usage: response.usage };
}

export function makeClient() {
  return new Anthropic();
}

/** Pick a backend: explicit choice, else the API when a key is set, else Claude Code. */
export function pickBackend(choice) {
  if (choice && choice !== 'auto') return choice;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'api' : 'claude-code';
}

/** Same verdict as judgePage, but through headless Claude Code. Images are written to dir and read with the Read tool. */
export async function judgePageViaClaudeCode(dir, { page, pairs, findings, expected }) {
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const { label, live, local } of pairs) {
    const stem = `${page}-${label.replace('/', '-')}`;
    writeFileSync(join(dir, `${stem}-live.png`), live);
    writeFileSync(join(dir, `${stem}-local.png`), local);
    lines.push(`- Capture ${label}: LIVE (reference) ${stem}-live.png, LOCAL (rebuild) ${stem}-local.png`);
  }
  const prompt = `Read every screenshot below with the Read tool (they are in the current directory), compare each LIVE/LOCAL pair, then return your verdict.

${lines.join('\n')}

EXPECTED CHANGES:
${expected}

AUTOMATED FINDINGS for page "${page}":
${JSON.stringify(findings, null, 1)}

Return your verdict for page "${page}".`;
  const args = ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify({ ...z.toJSONSchema(Verdict), $schema: undefined }),
    '--model', MODEL, '--effort', 'high', '--system-prompt', SYSTEM,
    '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence'];
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => reject(new Error(`could not run claude CLI: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 300)}`))));
  });
  const parsed = JSON.parse(out);
  const result = Array.isArray(parsed) ? parsed.findLast((m) => m.type === 'result') : parsed;
  if (!result || result.is_error) throw new Error(`Claude Code failed on "${page}": ${result?.result || result?.subtype || 'no result'}`);
  const v = Verdict.safeParse(result.structured_output);
  if (!v.success) throw new Error(`No structured verdict for "${page}" (${result.stop_reason})`);
  return { ...v.data, model: MODEL, backend: 'claude-code', cost_usd: result.total_cost_usd };
}
