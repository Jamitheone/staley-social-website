// Vercel serverless: audit form → TSS GHL sub-account contact + Marketing Pipeline card.
// Email notify is done client-side (browser → formsubmit); formsubmit 403s server-side POSTs.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { firstName, lastName, email, business, website, phone, honey, ref } = req.body || {};
  // ponytail: slug only, it becomes a GHL tag/source string
  const referrer = typeof ref === 'string' ? ref.replace(/[^a-z0-9-]/gi, '').slice(0, 32) : '';
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
      source: referrer ? `Referral: ${referrer}` : 'Website Audit Request',
      tags: referrer
        ? ['website-audit-request', 'referral', `referred-by-${referrer}`]
        : ['website-audit-request'],
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

  // drop the lead into the Marketing Pipeline as a New Lead card. The contact is already saved, so a
  // failed card never fails the request, but it must not vanish: retry once, then tag the contact
  // `card-failed` (findable in GHL) and log it. ponytail: no alert channel, the tag is the alert.
  if (contactId) {
    const card = JSON.stringify({
      locationId: process.env.GHL_TSS_LOCATION_ID,
      pipelineId: 'Ijv8HR88X8QFjaOayxKF', // Marketing Pipeline
      pipelineStageId: '7c70932c-8991-4857-afcb-86136fb17cb8', // New Lead
      contactId,
      name: `${business} - Website Audit`,
      status: 'open',
      source: 'Website Audit Request',
    });
    let cardOk = false;
    for (let attempt = 0; attempt < 2 && !cardOk; attempt++) {
      try {
        const r = await fetch(`${base}/opportunities/`, { method: 'POST', headers, body: card });
        // a repeat submission from the same contact already has its open card
        cardOk = r.ok || (await r.text()).includes('duplicate opportunity');
      } catch (e) { /* network blip, retry */ }
    }
    if (!cardOk) {
      console.error('GHL pipeline card failed after retry, tagging card-failed', contactId);
      await fetch(`${base}/contacts/${contactId}/tags`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tags: ['card-failed'] }),
      }).catch(() => {});
    }
  }

  return res.status(200).json({ ok: true, contactId });
}
