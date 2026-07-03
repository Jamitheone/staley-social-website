// Vercel serverless: audit form → TSS GHL sub-account contact (tag fires speed-to-lead workflow)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { firstName, lastName, email, business, website, phone, honey } = req.body || {};
  if (honey) return res.status(200).json({ ok: true }); // bot
  if (!firstName || !email || !business || !website) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const base = 'https://services.leadconnectorhq.com';
  const headers = {
    Authorization: `Bearer ${process.env.GHL_TSS_API_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };

  // ponytail: upsert WITHOUT phone (GHL dedupes by phone — see /ghl manual §5), then PUT phone after
  const upsert = await fetch(`${base}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      locationId: process.env.GHL_TSS_LOCATION_ID,
      firstName,
      lastName: lastName || '',
      email,
      companyName: business,
      website,
      source: 'Website Audit Request',
      tags: ['website-audit-request'],
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
      method: 'PUT',
      headers,
      body: JSON.stringify({ phone }),
    }).catch(() => {}); // phone is best-effort
  }

  return res.status(200).json({ ok: true });
}
