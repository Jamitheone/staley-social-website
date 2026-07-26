// Vercel serverless: is the GHL Prospecting widget alive?
// The widget dies whenever the GHL Prospecting add-on billing lapses and its
// public URL turns into a white 404 page. audit.html asks this endpoint on
// load and fails over to the native audit form when the widget is down.
// Server-side probe because the browser cannot read a cross-origin status.
const WIDGET_URL = 'https://services.leadconnectorhq.com/prospecting/widgets/public/6a669a92ca53d71c4a2d8307';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  try {
    const r = await fetch(WIDGET_URL, { redirect: 'follow' });
    const body = await r.text();
    // ponytail: 404 page titles itself "Widget Not Found"; r.ok alone is the real signal
    const ok = r.ok && !body.includes('Widget Not Found');
    return res.status(200).json({ ok });
  } catch {
    return res.status(200).json({ ok: false });
  }
}
