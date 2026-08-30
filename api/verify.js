const crypto = require('crypto');

function getDeviceSafe(id) {
  const s = String(id || 'XXXX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return (s + 'XXXXXXXX').slice(0, 8);
}

function makeCode(deviceId, secret, bucket) {
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

  const secret = process.env.KEY_SECRET || process.env.AROLINKS_TOKEN || 'change-me';
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const code = String(body.code || '').replace(/\s+/g, '');
  const deviceId = getDeviceSafe(body.deviceId);
  if (!/^\d{12}$/.test(code)) return res.status(400).json({ ok: false, error: '12-digit code required' });

  const bucket = Math.floor(Date.now() / (36 * 60 * 60 * 1000));
  const valid =
    code === makeCode(deviceId, secret, bucket) ||
    code === makeCode(deviceId, secret, bucket - 1);

  if (!valid) return res.status(401).json({ ok: false, error: 'Invalid code for this device' });
  return res.status(200).json({ ok: true, until: Date.now() + 36 * 60 * 60 * 1000 });
};
