export function collectScenarioSignals() {
  const visible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const focusable = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
    .filter(visible)
    .filter((node) => !node.hasAttribute('disabled') && node.getAttribute('tabindex') !== '-1');
  const forms = [...document.forms].map((form) => ({
    method: (form.method || 'get').toUpperCase(),
    action_origin_matches: (() => { try { return new URL(form.action || location.href, location.href).origin === location.origin; } catch { return false; } })(),
    required_controls: form.querySelectorAll('[required]').length,
    invalid_controls: form.querySelectorAll(':invalid').length,
    submit_controls: form.querySelectorAll('button[type="submit"],input[type="submit"],button:not([type])').length
  }));
  const consentCandidates = [...document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-label*="cookie" i],[aria-label*="consent" i]')].filter(visible).length;
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog')].filter(visible).map((node) => ({
    modal: node.getAttribute('aria-modal') === 'true' || node.matches('dialog[open]'),
    labelled: Boolean(node.getAttribute('aria-label') || node.getAttribute('aria-labelledby'))
  }));
  const html = document.documentElement;
  return {
    forms,
    consent: {
      visible_candidate_count: consentCandidates,
      cookie_count: document.cookie ? document.cookie.split(';').filter(Boolean).length : 0,
      local_storage_keys: Object.keys(localStorage).slice(0, 30),
      session_storage_keys: Object.keys(sessionStorage).slice(0, 30)
    },
    keyboard: {
      focusable_count: focusable.length,
      positive_tabindex_count: focusable.filter((node) => Number(node.getAttribute('tabindex')) > 0).length,
      autofocus_count: document.querySelectorAll('[autofocus]').length
    },
    dialogs,
    responsive: {
      horizontal_overflow_px: Math.max(0, html.scrollWidth - innerWidth),
      viewport_width: innerWidth,
      document_width: html.scrollWidth
    },
    commerce: {
      cart_links: document.querySelectorAll('a[href*="cart" i],a[href*="winkelmand" i]').length,
      checkout_links: document.querySelectorAll('a[href*="checkout" i],a[href*="afrekenen" i]').length,
      account_links: document.querySelectorAll('a[href*="my-account" i],a[href*="account" i]').length
    }
  };
}
