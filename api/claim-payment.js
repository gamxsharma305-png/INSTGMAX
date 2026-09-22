/**
 * POST /api/claim-payment
 * Body: { paymentId, deviceId, profileId }
 * User claims a Razorpay payment so unlock binds to THEIR device only.
 */
function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
}

function durationSecFromAmount(amountRupees) {
  const a = parseInt(String(amountRupees).replace(/[^0-9]/g, ''), 10) || 0;
  if (a === 1) return 20 * 60;
  if (a >= 399) return 90 * 24 * 60 * 60;
  if (a >= 299) return 60 * 24 * 60 * 60;
  if (a >= 199) return 30 * 24 * 60 * 60;
  return 30 * 24 * 60 * 60;
}

function planLabelFromAmount(amountRupees) {
  const a = parseInt(String(amountRupees).replace(/[^0-9]/g, ''), 10) || 0;
  if (a === 1) return 'Test 20 min';
  if (a >= 399) return '3 Months';
  if (a >= 299) return '2 Months';
  return '1 Month';
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
    try {
      v = JSON.parse(v);
    } catch (_) {
      return null;
    }
  }
  return typeof v === 'object' && v ? v : null;
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

async function redisIncr(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return;
  try {
    await fetch(url + '/incr/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (_) {}
}

async function redisIncrBy(key, n) {
  const { url, token } = redisEnv();
  if (!url || !token || !n) return;
  try {
    await fetch(url + '/incrby/' + encodeURIComponent(key) + '/' + n, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (_) {}
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

  let paymentId = String(body.paymentId || body.payment_id || '')
    .trim()
    .replace(/\s+/g, '');
  // accept pay_XXXX or bare id
  if (paymentId && !paymentId.startsWith('pay_') && /^[a-zA-Z0-9]+$/.test(paymentId)) {
    paymentId = paymentId.startsWith('pay_') ? paymentId : paymentId;
  }
  const deviceId = String(body.deviceId || '').trim();
  const profileId = normalizeProfile(body.profileId);

  if (!paymentId || paymentId.length < 6) {
    return res.status(400).json({ ok: false, error: 'Payment ID required (from Razorpay receipt)' });
  }
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'deviceId required' });
  }

  // Try with and without pay_ prefix
  let rec =
    (await redisGet('gmax:rzp_claim:' + paymentId).catch(() => null)) ||
    (await redisGet('gmax:rzp_claim:pay_' + paymentId.replace(/^pay_/, '')).catch(() => null));

  if (!rec) {
    // soft wait: payment webhook may lag a few seconds
    return res.status(404).json({
      ok: false,
      error: 'Payment not found yet. Wait 10–20 sec after paying, then try again.',
      code: 'NOT_FOUND'
    });
  }

  if (rec.claimedBy && rec.claimedBy !== deviceId) {
    return res.status(403).json({
      ok: false,
      error: 'This payment is already linked to another device.'
    });
  }

  if (rec.claimedBy === deviceId && rec.until && rec.until > Date.now()) {
    return res.status(200).json({
      ok: true,
      until: rec.until,
      plan: rec.plan,
      profileId: rec.profileId || profileId,
      already: true
    });
  }

  const amountRupees = parseInt(rec.amount, 10) || 0;
  const plan = rec.plan || planLabelFromAmount(amountRupees);
  const durationSec = rec.durationSec || durationSecFromAmount(amountRupees);
  const until = Date.now() + durationSec * 1000;
  const expSec = durationSec + 86400;

  const claimed = Object.assign({}, rec, {
    claimedBy: deviceId,
    profileId,
    plan,
    until,
    claimedAt: new Date().toISOString()
  });

  try {
    await redisSet('gmax:rzp_claim:' + (rec.paymentId || paymentId), claimed, 30 * 24 * 60 * 60);
    await redisSet(
      'gmax:access:' + profileId + ':' + deviceId,
      {
        until,
        plan,
        profileId,
        method: 'claim',
        paymentId: rec.paymentId || paymentId,
        amount: amountRupees
      },
      expSec
    );
    await redisSet(
      'gmax:plink_device:' + profileId + ':' + deviceId,
      { status: 'approved', until, plan, paymentId: rec.paymentId || paymentId, ts: Date.now() },
      expSec
    );
    if (!rec.claimedBy) {
      await redisIncr('gmax:stats:subs:' + profileId);
      if (amountRupees > 0) await redisIncrBy('gmax:stats:revenue:' + profileId, amountRupees);
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Save failed' });
  }

  return res.status(200).json({
    ok: true,
    until,
    plan,
    profileId,
    paymentId: rec.paymentId || paymentId
  });
};
