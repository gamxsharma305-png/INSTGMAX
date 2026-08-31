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

function signUnlock(deviceId, until, secret) {
  const payload = `${getDeviceSafe(deviceId)}.${until}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(payload + '.' + sig).toString('base64url');
}

function redisEnv() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  return { url, token };
}

async function redisSetSession(deviceId, until) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  const key = 'lumina:session:' + getDeviceSafe(deviceId);
  const ttl = Math.max(60_000, until - Date.now());
  try {
    const r = await fetch(
      url + '/set/' + encodeURIComponent(key) + '/' + encodeURIComponent(String(until)) + '?PX=' + ttl,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token } }
    );
    return r.ok;
  } catch (_) {
    return false;
  }
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
    return res.status(400).json({ ok: false, error: '12-digit code required (numbers only)' });
  }

  const bucket = Math.floor(Date.now() / (36 * 60 * 60 * 1000));
  const secrets = [];
  if (process.env.KEY_SECRET) secrets.push(process.env.KEY_SECRET);
  if (process.env.AROLINKS_TOKEN) secrets.push(process.env.AROLINKS_TOKEN);
  secrets.push('change-me');
  let valid = false;
  const seen = new Set();
  for (const s of secrets) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (code === makeCode(deviceId, s, bucket) || code === makeCode(deviceId, s, bucket - 1)) {
      valid = true;
      break;
    }
  }

  if (!valid) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid code for this device. Same phone/browser se Get Key → ads → code copy → Verify.'
    });
  }

  const until = Date.now() + 36 * 60 * 60 * 1000;
  const unlockToken = signUnlock(deviceId, until, secret);
  await redisSetSession(deviceId, until);

  return res.status(200).json({ ok: true, until, unlockToken, deviceId });
};
