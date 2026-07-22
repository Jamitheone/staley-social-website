// Vercel serverless: Staley OS ads-intake form → TSS GHL sub-account.
// Sent AFTER a client says yes to ads. Creates/updates the contact, attaches ALL
// questionnaire answers as an ADS INTAKE note, drops a card into the Marketing
// Pipeline, then generates a draft keyword/ads plan as a second note.
async function generateAdsPlan(business, answers) {
  const answersText = Object.entries(answers)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const schema = {
    type: 'object',
    properties: {
      platforms_recommended: { type: 'array', items: { type: 'string' } },
      primary_keywords: { type: 'array', items: { type: 'string' } },
      negative_keywords: { type: 'array', items: { type: 'string' } },
      ad_groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            headlines: { type: 'array', items: { type: 'string' } },
            descriptions: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'keywords', 'headlines', 'descriptions'],
        },
      },
      targeting_summary: { type: 'string' },
      daily_budget_split: { type: 'string' },
      next_steps: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'platforms_recommended', 'primary_keywords', 'negative_keywords',
      'ad_groups', 'targeting_summary', 'daily_budget_split', 'next_steps',
    ],
    // ponytail: no additionalProperties — Gemini responseSchema (OpenAPI subset) rejects it with a 400
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `Draft a Google/Meta ads keyword and targeting plan for this client based on their intake answers. Ground every keyword and ad group in what they actually said — don't invent services or areas they didn't mention.\n\n${business}\n\n${answersText}`,
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    }
  );
  if (!resp.ok) {
    console.error('Gemini ads-plan call failed', resp.status, await resp.text().catch(() => ''));
    return null;
  }
  const data = await resp.json();
  const text = data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
  return text ? JSON.parse(text) : null;
}

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
      source: 'Ads Intake Form',
      tags: ['ads-intake', 'ads-ready'],
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
    const noteBody = 'ADS INTAKE\n\n' +
      Object.entries(answers)
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    await fetch(`${base}/contacts/${contactId}/notes`, {
      method: 'POST', headers, body: JSON.stringify({ body: noteBody }),
    }).catch(() => {});

    // draft keyword/ads plan, generated from the same answers — best effort, never blocks the submit
    try {
      const plan = await generateAdsPlan(business, answers);
      if (plan) {
        const planBody = 'ADS PLAN (AI draft — review before deploying)\n\n' +
          `Platforms: ${plan.platforms_recommended.join(', ')}\n\n` +
          `Primary keywords:\n${plan.primary_keywords.map((k) => `- ${k}`).join('\n')}\n\n` +
          `Negative keywords:\n${plan.negative_keywords.map((k) => `- ${k}`).join('\n')}\n\n` +
          plan.ad_groups.map((g) =>
            `Ad group: ${g.name}\nKeywords: ${g.keywords.join(', ')}\nHeadlines: ${g.headlines.join(' | ')}\nDescriptions: ${g.descriptions.join(' | ')}`
          ).join('\n\n') +
          `\n\nTargeting: ${plan.targeting_summary}\n\n` +
          `Budget split: ${plan.daily_budget_split}\n\n` +
          `Next steps:\n${plan.next_steps.map((s) => `- ${s}`).join('\n')}`;
        await fetch(`${base}/contacts/${contactId}/notes`, {
          method: 'POST', headers, body: JSON.stringify({ body: planBody }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('ads-plan generation failed', err);
    }
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
        name: `${business} - Ads Intake`,
        status: 'open',
        source: 'Ads Intake Form',
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, contactId });
}
