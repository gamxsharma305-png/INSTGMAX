/**
 * POST /api/register-pending
 * Body: { deviceId, profileId, plan, amount }
 * No email required — Payment Page + webhook (no Razorpay API keys).
 */
const crypto = require('crypto');

function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
}

function durationSecFromAmount(amount) {
  const a = parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 0;
  if (a === 1) return 20 * 60;
  if (a >= 399) return 90 * 24 * 60 * 60;
  if (a >= 299) return 60 * 24 * 60 * 60;
  return 30 * 24 * 60 * 60;
}

function redisEnv() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  return { url, token };
}

async function redisSet(key, value, expSeconds) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  let path =
    url +
    '/set/' +
    encodeURIComponent(key) +
    '/' +
    encodeURIComponent(JSON.stringify(value));
  if (expSeconds) path += '?EX=' + expSeconds;
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  return r.ok;
}

async function redisLpush(key, value) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  const path =
    url +
    '/lpush/' +
    encodeURIComponent(key) +
    '/' +
    encodeURIComponent(JSON.stringify(value));
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  body = body || {};

  const deviceId = String(body.deviceId || '').trim();
  const profileId = normalizeProfile(body.profileId);
  const plan = String(body.plan || '1 Month').trim();
  const amount = parseInt(String(body.amount || '0').replace(/[^0-9]/g, ''), 10) || 0;

  if (!deviceId || amount < 1) {
    return res.status(400).json({ ok: false, error: 'deviceId and amount required' });
  }

  const id = crypto.randomBytes(6).toString('hex');
  const durationSec = durationSecFromAmount(amount);
  const record = {
    id,
    deviceId,
    profileId,
    plan,
    amount,
    durationSec,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  const ttl = 45 * 60; // 45 min
  try {
    await redisSet('gmax:pay:' + id, record, ttl);
    await redisSet(
      'gmax:plink_device:' + profileId + ':' + deviceId,
      { pendingId: id, amount, plan, status: 'pending', ts: Date.now() },
      ttl
    );
    // latest pending for this device wins (overwrite amount queue head via device pointer)
    await redisSet('gmax:pending_device:' + deviceId, record, ttl);
    await redisLpush('gmax:plink_pending:' + amount, record);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Redis save failed' });
  }

  return res.status(200).json({ ok: true, id, amount, plan, profileId });
};
