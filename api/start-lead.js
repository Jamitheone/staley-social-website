// Vercel serverless: self-serve checkout on-ramp. Captures the signup as a GHL contact
// BEFORE handing off to Square, so no payer is anonymous and abandoned carts are nurture-able.
// Clone of audit-lead.js, relaxed (no website), tagged self-serve-signup + tier + first-touch utm.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { firstName, lastName, email, business, phone, honey, tier, utm, ref } = req.body || {};
  if (honey) return res.status(200).json({ ok: true }); // bot
  if (!firstName || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // ponytail: tier is one of three known values; anything else drops to 197
  const t = ['197', '397', '797'].includes(String(tier)) ? String(tier) : '197';
  const src = typeof utm === 'string' ? utm.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : '';

  const base = 'https://services.leadconnectorhq.com';
  const headers = {
    Authorization: `Bearer ${process.env.GHL_TSS_API_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };

  // client referral slug: same sanitize + tags as audit-lead.js, so one tag search finds every referral
  const referrer = typeof ref === 'string' ? ref.replace(/[^a-z0-9-]/gi, '').slice(0, 32) : '';

  const tags = ['self-serve-signup', `tier-${t}`];
  if (src) tags.push(`src-${src}`);
  if (referrer) tags.push('referral', `referred-by-${referrer}`);

  const upsert = await fetch(`${base}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      locationId: process.env.GHL_TSS_LOCATION_ID,
      firstName,
      lastName: lastName || '',
      email,
      companyName: business || '',
      source: referrer ? `Referral: ${referrer}` : src ? `Self-Serve (${src})` : 'Self-Serve Signup',
      tags,
    }),
  });
  const data = await upsert.json();
  if (!upsert.ok) {
    console.error('GHL upsert failed', upsert.status, data);
    return res.status(502).json({ error: 'CRM error' });
  }

  const contactId = data.contact && data.contact.id;
  if (phone && contactId) {
    await fetch(`${base}/contacts/${contactId}`, {
      method: 'PUT', headers, body: JSON.stringify({ phone }),
    }).catch(() => {});
  }
  // Marketing Pipeline card so the signup is visible + abandoned carts are followable, best-effort
  if (contactId) {
    await fetch(`${base}/opportunities/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: process.env.GHL_TSS_LOCATION_ID,
        pipelineId: 'Ijv8HR88X8QFjaOayxKF',
        pipelineStageId: '7c70932c-8991-4857-afcb-86136fb17cb8',
        contactId,
        name: `${business || firstName} - Staley OS $${t}`,
        status: 'open',
        source: 'Self-Serve Signup',
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, contactId });
}
