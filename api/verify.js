/**
 * POST /api/verify
 * Body: { code, deviceId }
 *
 * Security layers (Upstash Redis hit-saving):
 * 1) Format pre-check (no Redis)
 * 2) Rate limit: 5 requests / minute / IP
 * 3) Negative cache: invalid keys cached 120s
 * Then existing pass / trial HMAC logic
 */
const crypto = require('crypto');

const PASS_PREFIX = 'lumina:pass:';
const RL_PREFIX = 'gmax:rl:verify:';
const NEG_PREFIX = 'gmax:invalid_key:';
const RL_LIMIT = 5;
const RL_WINDOW_SEC = 60;
const NEG_TTL_SEC = 120;

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

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  if (xf) return xf.split(',')[0].trim().slice(0, 64) || 'unknown';
  const xr = String(req.headers['x-real-ip'] || '').trim();
  if (xr) return xr.slice(0, 64);
  return 'unknown';
}

async function redisCmd(pathSuffix) {
  const { url, token } = redisEnv();
  if (!url || !token) return null;
  const r = await fetch(url + pathSuffix, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return j.result;
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
    try {
      v = JSON.parse(v);
    } catch (_) {
      return null;
    }
  }
  return typeof v === 'object' && v ? v : null;
}

async function redisGetRaw(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return null;
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.result == null || j.result === '') return null;
  return j.result;
}

async function redisSet(key, value, expSeconds) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  let path =
    url +
    '/set/' +
    encodeURIComponent(key) +
    '/' +
    encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
  if (expSeconds) path += '?EX=' + expSeconds;
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  return r.ok;
}

/** Rate limit: max RL_LIMIT per RL_WINDOW_SEC per IP. Returns { ok, count } */
async function checkRateLimit(ip) {
  const key = RL_PREFIX + ip;
  const count = await redisCmd('/incr/' + encodeURIComponent(key));
  const n = parseInt(count, 10);
  if (!Number.isFinite(n)) {
    // Redis down → fail open (allow) so real users not blocked
    return { ok: true, count: 0 };
  }
  if (n === 1) {
    await redisCmd('/expire/' + encodeURIComponent(key) + '/' + RL_WINDOW_SEC);
  }
  return { ok: n <= RL_LIMIT, count: n };
}

async function isNegativeCached(code) {
  const v = await redisGetRaw(NEG_PREFIX + code);
  return v != null && v !== '';
}

async function setNegativeCache(code) {
  // plain "1" — 1 Redis command, short TTL
  await redisSet(NEG_PREFIX + code, '1', NEG_TTL_SEC);
}

async function trackUnlock(deviceId) {
  const { url, token } = redisEnv();
  if (!url || !token || !deviceId) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const dkey = 'gmax:stats:day:' + day;
  const mkey = 'gmax:stats:month:' + month;
  const headers = { Authorization: 'Bearer ' + token };
  const id = getDeviceSafe(deviceId);
  try {
    // pipeline-ish sequential; only on SUCCESS (bots rarely reach here)
    await fetch(url + '/sadd/' + encodeURIComponent(dkey) + '/' + encodeURIComponent(id), {
      method: 'POST',
      headers
    });
    await fetch(url + '/sadd/' + encodeURIComponent(mkey) + '/' + encodeURIComponent(id), {
      method: 'POST',
      headers
    });
    await fetch(url + '/expire/' + encodeURIComponent(dkey) + '/3456000', {
      method: 'POST',
      headers
    });
    await fetch(url + '/expire/' + encodeURIComponent(mkey) + '/3456000', {
      method: 'POST',
      headers
    });
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const secret = process.env.KEY_SECRET || process.env.AROLINKS_TOKEN || 'change-me';
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  body = body || {};

  const code = String(body.code || '').replace(/\s+/g, '');
  const deviceId = getDeviceSafe(body.deviceId);

  // ——— Layer 1: format (0 Redis commands) ———
  if (!/^\d{12}$/.test(code)) {
    return res.status(400).json({ ok: false, error: '12-digit code required' });
  }

  // ——— Layer 2: rate limit per IP ———
  const ip = clientIp(req);
  try {
    const rl = await checkRateLimit(ip);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(RL_WINDOW_SEC));
      return res.status(429).json({
        ok: false,
        error: 'Too many attempts. Try again in 1 minute.',
        retryAfter: RL_WINDOW_SEC
      });
    }
  } catch (_) {
    // fail open
  }

  // ——— Layer 3: negative cache (1 GET) ———
  try {
    if (await isNegativeCached(code)) {
      return res.status(404).json({ ok: false, error: 'Invalid key' });
    }
  } catch (_) {}

  // ——— Existing business logic ———
  try {
    const rec = await redisGet(PASS_PREFIX + code);
    if (rec && rec.plan === 'month' && rec.until > Date.now()) {
      const boundRaw = String(rec.deviceId || '').trim();
      const unbound =
        !boundRaw || boundRaw === 'OPEN' || getDeviceSafe(boundRaw) === 'XXXXXXXXXXXX';
      if (unbound) {
        rec.deviceId = deviceId;
        const ttl = Math.max(60, Math.floor((rec.until - Date.now()) / 1000));
        await redisSet(PASS_PREFIX + code, rec, ttl);
      } else if (getDeviceSafe(rec.deviceId) !== deviceId) {
        // wrong device — do not negative-cache (code is valid, just bound)
        return res.status(403).json({
          ok: false,
          error: 'Ye code kisi aur device ke liye hai. Sirf payment wale phone par chalega.'
        });
      }
      await trackUnlock(deviceId);
      return res.status(200).json({
        ok: true,
        until: rec.until,
        plan: 'month',
        days: rec.days || 30
      });
    }
  } catch (e) {}

  const bucket = Math.floor(Date.now() / (36 * 60 * 60 * 1000));
  const valid =
    code === makeCode(deviceId, secret, bucket) ||
    code === makeCode(deviceId, secret, bucket - 1);

  if (!valid) {
    try {
      await setNegativeCache(code);
    } catch (_) {}
    return res.status(401).json({ ok: false, error: 'Invalid code for this device' });
  }

  await trackUnlock(deviceId);
  return res.status(200).json({
    ok: true,
    until: Date.now() + 36 * 60 * 60 * 1000,
    plan: 'trial'
  });
};
