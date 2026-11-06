// Single source of truth: tier -> live Square checkout link + display name.
// Shared by checkout.html (browser) and tests/checkout_check.mjs (node), so the
// money path (tier -> correct price) can't drift. ponytail: plain UMD, no bundler.
(function (root) {
  var SQUARE = {
    '197': 'https://square.link/u/f8LEH8D0',
    '397': 'https://square.link/u/7M66IOci',
    '797': 'https://square.link/u/X50xAW6p',
  };
  var TIERS = {
    '197': { name: 'Starter OS', price: '$197/mo' },
    '397': { name: 'Growth OS', price: '$397/mo' },
    '797': { name: 'Command OS', price: '$797/mo' },
  };
  function pickTier(t) { return ['197', '397', '797'].includes(String(t)) ? String(t) : '197'; }
  function sanitizeUtm(s) { return typeof s === 'string' ? s.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : ''; }
  var api = { SQUARE: SQUARE, TIERS: TIERS, pickTier: pickTier, sanitizeUtm: sanitizeUtm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckoutConfig = api;
})(typeof window !== 'undefined' ? window : globalThis);
