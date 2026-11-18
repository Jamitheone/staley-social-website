// Our own lead store comes first. Every form handler posts the lead to our tracking server
// (agents/track_server.py /lead, one JSON line per submit) and treats GHL as the second copy.
// ponytail: one tunnel to one Mac, 4 s cap, no queue. If that Mac is asleep GHL is the only copy;
// add a buffer here if both ever miss the same lead (the handler logs "lead lost" when that happens).
export async function storeLead(form, fields) {
  try {
    const r = await fetch('https://track.thestaleysocial.com/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form, ...fields }),
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch (e) {
    console.error('own lead store failed', form, e && e.message);
    return false;
  }
}

// .invalid is a reserved test domain: store it in our own store, never send it to GHL.
// Live oracle: POST a @x.invalid email, expect { ok: true, stored: true, test: true }.
export const isTest = (email) => /\.invalid$/i.test(String(email || '').trim());

// GHL contact upsert that never throws: { ok, status, data }
export async function crmUpsert(url, headers, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e && e.message } };
  }
}
