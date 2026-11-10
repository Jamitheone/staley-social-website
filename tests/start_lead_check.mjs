// api/start-lead.js with fetch mocked (never hits the live CRM): a ?ref= signup must be tagged
// exactly like an audit referral, a plain signup must not. Run: node tests/start_lead_check.mjs
import assert from 'node:assert';
import handler from '../api/start-lead.js';

async function run(body) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ contact: { id: 'c1' } }) };
  };
  const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
  await handler({ method: 'POST', body }, res);
  return { res, upsert: calls.find((c) => c.url.endsWith('/contacts/upsert')).body };
}

const base = { firstName: 'Test', email: 't@example.com', tier: '397' };

let r = await run({ ...base, utm: 'efp', ref: 'efp' });
assert.equal(r.res.code, 200);
assert.equal(r.upsert.source, 'Referral: efp');
for (const t of ['self-serve-signup', 'tier-397', 'src-efp', 'referral', 'referred-by-efp']) assert(r.upsert.tags.includes(t), `missing tag ${t}`);

r = await run({ ...base, utm: 'inapp_emily' });
assert.equal(r.upsert.source, 'Self-Serve (inapp_emily)');
assert(!r.upsert.tags.includes('referral'), 'campaign utm must not be tagged as a referral');

r = await run({ ...base, ref: '<script>x</script>' });
assert(r.upsert.tags.includes('referred-by-scriptxscript'), 'ref must be sanitized');

r = await run(base);
assert.equal(r.upsert.source, 'Self-Serve Signup');
console.log('start_lead_check: PASS');
