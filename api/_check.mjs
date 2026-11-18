// Runnable check for the own-store-first lead handlers: node api/_check.mjs
// Mocks fetch, so nothing leaves the machine. Fails loudly if a handler blocks a lead it should keep.
import assert from 'node:assert';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'leadcheck-'));
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
for (const f of ['_own.js', 'start-lead.js', 'audit-lead.js', 'brand-intake.js', 'ads-intake.js']) copyFileSync(join(here, f), join(tmp, f));
const load = async (f) => (await import(pathToFileURL(join(tmp, f)).href)).default;

let own, ghl, calls;
globalThis.fetch = async (url, opts = {}) => {
  calls.push(String(url));
  if (String(url).includes('track.thestaleysocial.com/lead')) {
    if (own === 'down') throw new Error('tunnel down');
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  }
  if (String(url).includes('generativelanguage')) return { ok: false, status: 500, text: async () => '' };
  if (ghl === 'down') throw new Error('ghl down');
  if (ghl === '401') return { ok: false, status: 401, json: async () => ({ message: 'bad token' }), text: async () => '' };
  return { ok: true, status: 200, json: async () => ({ contact: { id: 'c1' } }), text: async () => '' };
};
console.error = () => {};
const run = async (h, body) => {
  calls = [];
  const out = {};
  const res = { status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  await h({ method: 'POST', body }, res);
  return out;
};

const forms = {
  'start-lead.js': { firstName: 'A', email: 'a@real.com', tier: '397' },
  'audit-lead.js': { firstName: 'A', email: 'a@real.com', business: 'B', website: 'b.com' },
  'brand-intake.js': { contactName: 'A B', email: 'a@real.com', business: 'B', answers: { q: 'x' } },
  'ads-intake.js': { contactName: 'A B', email: 'a@real.com', business: 'B', answers: { q: 'x' } },
};
for (const [f, body] of Object.entries(forms)) {
  const h = await load(f);
  own = 'up'; ghl = 'up';
  let r = await run(h, body);
  assert.deepEqual([r.code, r.body.ok, r.body.stored, r.body.contactId], [200, true, true, 'c1'], f + ' both up');
  assert(calls[0].includes('track.thestaleysocial.com/lead'), f + ' our store is asked first');
  for (const g of ['down', '401']) {
    own = 'up'; ghl = g;
    r = await run(h, body);
    assert.deepEqual([r.code, r.body.ok, r.body.stored, r.body.crm], [200, true, true, false], f + ' GHL ' + g + ', we kept it');
  }
  own = 'down'; ghl = 'up';
  r = await run(h, body);
  assert.deepEqual([r.code, r.body.ok, r.body.stored], [200, true, false], f + ' our store down, GHL kept it');
  own = 'down'; ghl = 'down';
  r = await run(h, body);
  if (f === 'start-lead.js') assert.deepEqual([r.code, r.body.ok], [200, true], 'checkout is never blocked');
  else assert.equal(r.code, 502, f + ' both down tells the visitor');
  own = 'up'; ghl = 'up';
  r = await run(h, { ...body, email: 'check@store.invalid' });
  assert.deepEqual([r.code, r.body.test, r.body.stored], [200, true, true], f + ' test email stored');
  assert(calls.every((u) => !u.includes('leadconnectorhq')), f + ' test email never reaches GHL');
  r = await run(h, { ...body, honey: 'x' });
  assert(r.code === 200 && calls.length === 0, f + ' bot trap stores nothing');
  r = await run(h, {});
  assert(r.code === 400 && calls.length === 0, f + ' missing fields');
}
console.log('lead handlers: ALL PASS (4 handlers x 8 cases)');
