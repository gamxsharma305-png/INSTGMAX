const crypto = require('crypto');
const PASS_PREFIX = 'lumina:pass:';

function getDeviceSafe(id) {
  const s = String(id || 'XXXX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return (s + 'XXXXXXXXXXXX').slice(0, 12);
}

function makeCode(deviceId, secret, bucket) {
  const h = crypto
    .createHmac('sha256', secret)
    .update(getDeviceSafe(deviceId).slice(0, 8) + ':' + bucket)
    .digest('hex');
  let out = '';
  for (let i = 0; i < h.length && out.length < 12; i++) {
    const n = parseInt(h[i], 16);
    if (!Number.isNaN(n)) out += String(n % 10);
  }
  while (out.length < 12) out += '0';
  return out.slice(0, 12);
}

function redisEnv() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  return { url, token };
}

async function redisGet(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return null;
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.result == null || j.result === '') return null;
  let v = j.result;
  for (let i = 0; i < 3; i++) {
    if (typeof v === 'object' && v !== null) return v;
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  return typeof v === 'object' && v ? v : null;
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

  if (!/^\d{12}$/.test(code)) {
    return res.status(400).json({ ok: false, error: '12-digit code required' });
  }

  try {
    const rec = await redisGet(PASS_PREFIX + code);
    if (rec && rec.plan === 'month' && rec.until > Date.now()) {
      const bound = getDeviceSafe(rec.deviceId);
      if (bound !== deviceId) {
        return res.status(403).json({
          ok: false,
          error: 'Ye code kisi aur device ke liye hai. Sirf payment wale phone par chalega.'
        });
      }
      return res.status(200).json({ ok: true, until: rec.until, plan: 'month', days: 30 });
    }
  } catch (e) {}

  const bucket = Math.floor(Date.now() / (36 * 60 * 60 * 1000));
  const valid =
    code === makeCode(deviceId, secret, bucket) ||
    code === makeCode(deviceId, secret, bucket - 1);

  if (!valid) {
    return res.status(401).json({ ok: false, error: 'Invalid code for this device' });
  }

  return res.status(200).json({
    ok: true,
    until: Date.now() + 36 * 60 * 60 * 1000,
    plan: 'trial'
  });
};
