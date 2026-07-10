// Vercel serverless: Staley OS brand-intake form → TSS GHL sub-account.
// Creates/updates the contact, attaches ALL questionnaire answers as a note,
// drops a card into the Marketing Pipeline so it shows in the daily leadcheck brief.
// Reliable path (no FormSubmit dependency). INFO ONLY — never auto-generates anything.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { contactName, email, phone, business, answers, honey } = req.body || {};
  if (honey) return res.status(200).json({ ok: true }); // bot trap
  if (!email || !business) return res.status(400).json({ error: 'Missing required fields' });

  const [firstName, ...rest] = String(contactName || '').trim().split(' ');
  const base = 'https://services.leadconnectorhq.com';
  const headers = {
    Authorization: `Bearer ${process.env.GHL_TSS_API_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };

  // upsert WITHOUT phone (GHL dedupes by phone — /ghl manual §5), PUT phone after
  const upsert = await fetch(`${base}/contacts/upsert`, {
    method: 'POST', headers,
    body: JSON.stringify({
      locationId: process.env.GHL_TSS_LOCATION_ID,
      firstName: firstName || business,
      lastName: rest.join(' '),
      email,
      companyName: business,
      source: 'Brand Intake Form',
      tags: ['brand-intake', 'website-ready'],
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

  // full questionnaire → one note on the contact (this is the info Jameson works with)
  if (contactId && answers && typeof answers === 'object') {
    const noteBody = 'BRAND INTAKE\n\n' +
      Object.entries(answers)
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    await fetch(`${base}/contacts/${contactId}/notes`, {
      method: 'POST', headers, body: JSON.stringify({ body: noteBody }),
    }).catch(() => {});
  }

  // Marketing Pipeline card → surfaces in the daily leadcheck brief = the notification
  if (contactId) {
    await fetch(`${base}/opportunities/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: process.env.GHL_TSS_LOCATION_ID,
        pipelineId: 'Ijv8HR88X8QFjaOayxKF',
        pipelineStageId: '7c70932c-8991-4857-afcb-86136fb17cb8',
        contactId,
        name: `${business} - Brand Intake`,
        status: 'open',
        source: 'Brand Intake Form',
      }),
    }).catch(() => {});
  }

  // instant email notify to Jameson via GHL (conversations use Version 2021-04-15)
  if (contactId) {
    const summary = Object.entries(answers || {})
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `<p style="margin:4px 0"><b>${k}:</b> ${v}</p>`).join('');
    await fetch(`${base}/conversations/messages`, {
      method: 'POST',
      headers: { ...headers, Version: '2021-04-15' },
      body: JSON.stringify({
        type: 'Email',
        contactId,
        emailTo: 'thestaleysocial@gmail.com',
        subject: `New brand intake: ${business}`,
        html: `<h2>New Staley OS brand intake</h2><p><b>From:</b> ${contactName || ''} (${email}${phone ? ', ' + phone : ''})</p>${summary}`,
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, contactId });
}
