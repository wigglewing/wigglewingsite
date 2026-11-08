// wigglewing.com Worker. Static pages come from assets; this handles POST /api/contact:
// Turnstile check -> save to D1 -> email the inbox. The message is kept even if the email fails.

const LIMITS = { name: 200, email: 254, app: 50, message: 5000, device: 500 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // www.wigglewing.com -> wigglewing.com, keeping the path (Netlify did this before).
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      return contact(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};

async function contact(request, env, ctx) {
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  const reply = (status, error) => wantsJson
    ? Response.json(error ? { ok: false, error } : { ok: true }, { status })
    // No-JS fallback: back to the form with a flag the page can show.
    : Response.redirect(new URL(`/support/?${error ? 'error' : 'sent'}=1#contact`, request.url), 303);

  let form;
  try { form = await request.formData(); } catch { return reply(400, 'bad-request'); }
  const field = (k) => {
    const v = String(form.get(k) ?? '').trim().slice(0, LIMITS[k] ?? 200);
    return k === 'message' ? v : v.replace(/[\r\n]+/g, ' '); // single-line fields end up in the subject
  };

  // Honeypot: bots fill it, people never see it. Pretend it worked.
  if (field('company')) return reply(200);

  const email = field('email');
  if (!EMAIL_RE.test(email)) return reply(400, 'invalid-email');

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await turnstileOk(form.get('cf-turnstile-response'), ip, env))) return reply(403, 'bot-check-failed');

  const msg = {
    name: field('name'), email, app: field('app'), message: field('message'),
    device: field('device-info'), country: request.cf?.country || '',
  };
  const { meta } = await env.DB.prepare(
    'INSERT INTO messages (name, email, app, message, device, country) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(msg.name, msg.email, msg.app, msg.message, msg.device, msg.country).run();

  // Email after responding; the row records whether it went out.
  ctx.waitUntil(notify(env, msg, meta.last_row_id));
  return reply(200);
}

async function turnstileOk(token, ip, env) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', String(token));
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const out = await res.json();
    return out.success === true;
  } catch {
    return false;
  }
}

async function notify(env, msg, id) {
  const subject = `[wigglewing.com] ${msg.app || 'Contact'}: ${msg.name || msg.email}`.slice(0, 150);
  const text = [
    `From: ${msg.name || '(no name)'} <${msg.email}>`,
    `App: ${msg.app || '(not chosen)'}`,
    `Country: ${msg.country || '?'}`,
    msg.device ? `Device: ${msg.device}` : null,
    '',
    msg.message || '(no message)',
    '',
    `Message #${id}. Reply to this email to answer them.`,
  ].filter((l) => l !== null).join('\n');
  try {
    await env.EMAIL.send({ to: env.CONTACT_TO, from: env.CONTACT_FROM, replyTo: msg.email, subject, text });
    await env.DB.prepare('UPDATE messages SET emailed = 1 WHERE id = ?').bind(id).run();
  } catch (e) {
    console.error('contact email failed', e?.code, e?.message);
    await env.DB.prepare('UPDATE messages SET email_error = ? WHERE id = ?').bind(`${e?.code || ''} ${e?.message || e}`.slice(0, 500), id).run();
  }
}
