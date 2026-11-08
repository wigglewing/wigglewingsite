// LLM judge: Claude compares live vs local screenshots for one page, given the deterministic findings.
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
