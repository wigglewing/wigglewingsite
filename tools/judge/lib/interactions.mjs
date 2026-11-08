import { stubTurnstile } from './turnstile-stub.mjs';
// Behaviour checks on the local site: the things a static screenshot can't show.
const f = (id, status, detail) => ({ id, status, detail });

export async function interactions(browser, base) {
  const out = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  await stubTurnstile(context);
  const p = await context.newPage();
  const step = async (id, label, fn) => {
    try { await fn(); out.push(f(id, 'pass', label)); } catch (e) { out.push(f(id, 'fail', `${label}: ${e.message.split('\n')[0]}`)); }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

  await p.goto(base + '/support/');
  await step('ux.faq-filter', 'GloveLens chip shows only shared and GloveLens questions', async () => {
    await p.getByRole('button', { name: 'GloveLens' }).click();
    const shown = await p.locator('details:visible summary').allInnerTexts();
    expect(shown.length === 3 && shown.some((t) => /lighting/i.test(t)) && !shown.some((t) => /GlutenScan|puzzles/i.test(t)), `shown: ${shown.join(' | ')}`);
    expect(await p.getByRole('button', { name: 'GloveLens' }).getAttribute('aria-pressed') === 'true', 'chip not pressed');
    await p.getByRole('button', { name: 'All apps' }).click();
    expect(await p.locator('details:visible').count() === 5, 'All apps did not restore 5 questions');
  });
  await step('ux.faq-open', 'A question opens to show its answer', async () => {
    await p.getByText('How do I restore a purchase?').click();
    await p.getByText(/Restore Purchases/).waitFor({ state: 'visible', timeout: 2000 });
  });
  await step('ux.form-validate', 'Bad email shows an inline error and blocks sending', async () => {
    let posted = false;
    await p.route('**/api/contact', (r) => { if (r.request().method() === 'POST') posted = true; return r.continue(); });
    await p.getByLabel('Email').fill('chris@');
    await p.getByRole('button', { name: /Send message/ }).click();
    await p.locator('#contact-email-error').waitFor({ state: 'visible', timeout: 2000 });
    expect(await p.getByLabel('Email').getAttribute('aria-invalid') === 'true', 'aria-invalid not set');
    expect(!posted, 'form posted despite invalid email');
    await p.getByLabel('Email').fill('chris@example.com');
    await p.locator('#contact-email-error').waitFor({ state: 'hidden', timeout: 2000 });
    await p.unroute('**/api/contact');
  });
  await step('ux.form-send', 'Valid form posts to /api/contact and shows the success toast', async () => {
    let body = '';
    let postedTo = '';
    // Only the form endpoint: the Turnstile widget makes its own POSTs to challenges.cloudflare.com.
    await p.route('**/api/contact', (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      body = r.request().postData() || '';
      postedTo = new URL(r.request().url()).pathname;
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await p.getByLabel('Name').fill('Judge');
    await p.getByLabel('Email').fill('judge@example.com');
    await p.getByLabel('Message').fill('Hello');
    await p.getByRole('button', { name: /Send message/ }).click();
    await p.getByText('Message sent').waitFor({ state: 'visible', timeout: 3000 });
    const params = new URLSearchParams(body);
    expect(postedTo === '/api/contact' && params.get('email') === 'judge@example.com', `posted to ${postedTo}: ${body.slice(0, 120)}`);
    expect(await p.locator('form .cf-turnstile').count() === 1, 'Turnstile widget missing from the form');
    await p.unroute('**/api/contact');
  });
  await step('ux.form-fail', 'A failed send shows the error banner', async () => {
    await p.route('**/api/contact', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, body: 'no' }) : r.continue()));
    await p.getByLabel('Email').fill('judge@example.com');
    await p.getByRole('button', { name: /Send message/ }).click();
    await p.getByText("Your message didn't send.").waitFor({ state: 'visible', timeout: 3000 });
    await p.unroute('**/api/contact');
  });
  await step('ux.dark-mode', 'Dark mode switch applies and persists across pages', async () => {
    const sw = p.getByRole('switch', { name: 'Dark mode' });
    expect(await sw.getAttribute('aria-checked') === 'false', 'switch should start off in light mode');
    await sw.click();
    expect(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme not dark');
    await p.goto(base + '/about/');
    expect(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme not remembered');
    expect(await p.getByRole('switch', { name: 'Dark mode' }).getAttribute('aria-checked') === 'true', 'switch state not restored');
  });
  await context.close();
  return out;
}
