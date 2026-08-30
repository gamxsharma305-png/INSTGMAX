
const crypto = require('crypto');

const GENERATE_BASE = 'https://auth.pwasmultiverse.workers.dev/generate?code=';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.AROLINKS_TOKEN;
  const secret = process.env.KEY_SECRET || process.env.AROLINKS_TOKEN || 'change-me';
  if (!token) return res.status(500).json({ error: 'AROLINKS_TOKEN missing in Vercel env' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const deviceId = getDeviceSafe(body.deviceId);
  const code = makeCode(deviceId, secret);

  // Your auth worker shows the code after the user completes the link flow
  const targetURL = GENERATE_BASE + encodeURIComponent(code);

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
    return res.status(200).json({
      ok: true,
      shortUrl: short || targetURL,
      fallbackUrl: targetURL,
    });
  } catch (e) {
    return res.status(200).json({
      ok: true,
      shortUrl: targetURL,
      fallbackUrl: targetURL,
    });
  }
};
