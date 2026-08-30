const crypto = require('crypto');

function getDeviceSafe(id) {
  const s = String(id || 'XXXX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return (s + 'XXXXXXXX').slice(0, 8);
}

function makeCode(deviceId, secret) {
  const bucket = Math.floor(Date.now() / (36 * 60 * 60 * 1000));
  const h = crypto.createHmac('sha256', secret).update(`${getDeviceSafe(deviceId)}:${bucket}`).digest('hex');
  let out = '';
  for (let i = 0; i < h.length && out.length < 12; i++) {
    const n = parseInt(h[i], 16);
    if (!Number.isNaN(n)) out += String(n % 10);
  }
  while (out.length < 12) out += '0';
  return out.slice(0, 12);
}

function makeRevealUrl(siteUrl, code, secret) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  const exp = Date.now() + 30 * 60 * 1000; // 30 min to complete ad link
  const sig = crypto.createHmac('sha256', secret).update(`${code}.${exp}`).digest('hex').slice(0, 24);
  const q = `c=${encodeURIComponent(code)}&e=${exp}&s=${encodeURIComponent(sig)}`;
  return `${base}/api/reveal?${q}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.AROLINKS_TOKEN;
  const secret = process.env.KEY_SECRET || process.env.AROLINKS_TOKEN || 'change-me';
  const siteUrl = process.env.SITE_URL;

  if (!token) {
    return res.status(500).json({
      error: 'AROLINKS_TOKEN missing in Vercel env — short link + ads cannot be created',
    });
  }
  if (!siteUrl) {
    return res.status(500).json({
      error: 'SITE_URL missing in Vercel env — set https://your-app.vercel.app',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const deviceId = getDeviceSafe(body.deviceId);
  const code = makeCode(deviceId, secret);

  // Reveal page on THIS site (signed). User must open short link first → ads → then code.
  // Never return the code or the plain reveal URL as the primary link.
  const targetURL = makeRevealUrl(siteUrl, code, secret);

  try {
    const api =
      'https://arolinks.com/api?api=' +
      encodeURIComponent(token) +
      '&url=' +
      encodeURIComponent(targetURL);
    const r = await fetch(api, { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    const short =
      (data && data.status === 'success' && (data.shortenedUrl || data.shorturl || data.short)) ||
      null;

    if (!short) {
      return res.status(502).json({
        ok: false,
        error:
          (data && (data.message || data.error)) ||
          'AroLinks short link failed. Check AROLINKS_TOKEN. Key is not shown directly.',
      });
    }

    // Only return the short URL — never the reveal/target URL as shortUrl
    return res.status(200).json({
      ok: true,
      shortUrl: short,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: 'Could not create ad link. Try again later. Key is not given directly.',
    });
  }
};
