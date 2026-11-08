// wigglewing.com: small progressive enhancements. Every page works without this file.
(() => {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ---- Dark mode switch. <head> applies the saved choice before paint; this wires the control.
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : media.matches);
  document.querySelectorAll('[data-theme-switch]').forEach((btn) => {
    const sync = () => btn.setAttribute('aria-checked', String(isDark()));
    sync();
    media.addEventListener('change', sync);
    btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      store.set('ww-theme', next);
      sync();
    });
  });

  // ---- Support: filter FAQs by app.
  const filter = document.querySelector('[data-faq-filter]');
  if (filter) {
    const items = document.querySelectorAll('[data-faq-app]');
    filter.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-app]');
      if (!chip) return;
      const app = chip.dataset.app;
      filter.querySelectorAll('[data-app]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      items.forEach((it) => { it.hidden = !(app === 'all' || it.dataset.faqApp === 'all' || it.dataset.faqApp === app); });
    });
  }

  // ---- Support: contact form. Inline validation, then post to the Worker (/api/contact),
  // which checks the Turnstile token, saves the message and emails the team.
  const form = document.querySelector('[data-contact-form]');
  if (form) {
    const email = form.querySelector('#contact-email');
    const err = form.querySelector('#contact-email-error');
    const hint = form.querySelector('#contact-email-hint');
    const failed = form.querySelector('[data-form-failed]');
    const failedText = failed.querySelector('[data-form-failed-text]');
    const toast = document.querySelector('[data-toast]');
    const valid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    const show = (bad) => {
      err.hidden = !bad;
      hint.hidden = bad;
      email.setAttribute('aria-invalid', bad ? 'true' : 'false');
    };
    email.addEventListener('blur', () => email.value && show(!valid()));
    email.addEventListener('input', () => !err.hidden && show(!valid()));

    let timer;
    const showToast = () => {
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => { toast.hidden = true; }, 6000);
    };
    toast?.querySelector('[data-toast-close]')?.addEventListener('click', () => { toast.hidden = true; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      failed.hidden = true;
      if (!valid()) { show(true); email.focus(); return; }
      const data = new FormData(form);
      if (data.get('device-info')) data.set('device-info', navigator.userAgent);
      const btn = form.querySelector('[type="submit"]');
      btn.setAttribute('aria-disabled', 'true');
      try {
        const res = await fetch(form.getAttribute('action'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams(data).toString(),
        });
        if (!res.ok) {
          const out = await res.json().catch(() => ({}));
          throw new Error(out.error || String(res.status));
        }
        form.reset();
        showToast();
      } catch (e2) {
        failedText.textContent = e2.message === 'bot-check-failed'
          ? 'Complete the check above the button, then send again.'
          : 'Check your connection and try again.';
        failed.hidden = false;
      } finally {
        btn.removeAttribute('aria-disabled');
        window.turnstile?.reset(); // tokens work once
      }
    });
  }
})();
