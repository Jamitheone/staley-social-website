// upgrade.html (the in-app paywall) must cover every checkout tier in every language,
// and carry no em or en dashes. Run: node tests/upgrade_check.cjs
const fs = require('fs'), path = require('path'), assert = require('assert');
const { TIERS } = require('../checkout-config.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'upgrade.html'), 'utf8');
const m = html.match(/var COPY = (\{[\s\S]*?\n    \});/);
assert(m, 'COPY dict not found in upgrade.html');
const COPY = new Function('return ' + m[1])();
for (const lang of ['en', 'ru']) {
  for (const tier of Object.keys(TIERS)) {
    assert(Array.isArray(COPY[lang].tiers[tier]) && COPY[lang].tiers[tier].length, `${lang} missing tier ${tier}`);
  }
  assert.deepStrictEqual(Object.keys(COPY[lang].tiers).sort(), Object.keys(TIERS).sort(), `${lang} has a tier checkout does not sell`);
  for (const k of ['eyebrow', 'h1', 'freeLabel', 'lockedLabel', 'unlock', 'foot']) assert(COPY[lang][k], `${lang} missing ${k}`);
}
assert(!/[—–]/.test(html), 'em or en dash in upgrade.html');
console.log('upgrade_check: PASS');
