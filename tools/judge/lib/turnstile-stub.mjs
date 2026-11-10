// Cloudflare Turnstile only runs on its allowed hostnames and keeps the network busy elsewhere,
// so the judge swaps the script for a stub: a fixed-size box and a fake token field.
const STUB = `(() => {
  const render = (el) => {
    if (el.dataset.stubbed) return;
    el.dataset.stubbed = '1';
    el.innerHTML = '<div style="height:65px;border:1px solid currentColor;opacity:.3;border-radius:4px"></div>'
      + '<input type="hidden" name="cf-turnstile-response" value="judge-stub-token">';
  };
  window.turnstile = { render, reset() {}, getResponse: () => 'judge-stub-token' };
  const go = () => document.querySelectorAll('.cf-turnstile').forEach(render);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
})();`;

export async function stubTurnstile(context) {
  await context.route('https://challenges.cloudflare.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }));
}
