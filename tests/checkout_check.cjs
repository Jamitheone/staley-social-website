// Money-path check for the self-serve checkout on-ramp. Run: node tests/checkout_check.cjs
const assert = require('assert');
const C = require('../checkout-config.js');

// tier -> correct LIVE Square link (wrong link = wrong price charged)
assert.strictEqual(C.SQUARE['197'], 'https://square.link/u/f8LEH8D0');
assert.strictEqual(C.SQUARE['397'], 'https://square.link/u/7M66IOci');
assert.strictEqual(C.SQUARE['797'], 'https://square.link/u/X50xAW6p');
// three distinct links, no copy-paste collision
assert.strictEqual(new Set(Object.values(C.SQUARE)).size, 3);
// unknown / tampered tier falls back to the cheapest, never crashes or over-charges
assert.strictEqual(C.pickTier('999'), '197');
assert.strictEqual(C.pickTier(null), '197');
assert.strictEqual(C.pickTier('397'), '397');
// every tier has a display name + price and a link
['197', '397', '797'].forEach((t) => {
  assert.ok(C.TIERS[t].name && C.TIERS[t].price && C.SQUARE[t]);
});
// utm sanitize strips junk, caps length, keeps safe chars
assert.strictEqual(C.sanitizeUtm('ig_reel-1'), 'ig_reel-1');
assert.strictEqual(C.sanitizeUtm('<script>x'), 'scriptx');
assert.strictEqual(C.sanitizeUtm('a'.repeat(99)).length, 40);
assert.strictEqual(C.sanitizeUtm(42), '');
console.log('checkout_check: PASS');
