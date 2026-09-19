/**
 * POST /api/create-order
 * Body: { name, email, mobile, plan, amount, deviceId, profileId }
 * Creates Razorpay order (amount in paise)
 */
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_Td9HUf4sKx9ajF';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'jImRQcWV2EA2vY6fdq69zbgY';

function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
}

function planDays(plan) {
  const p = String(plan || '').toLowerCase();
  if (p.indexOf('3') >= 0 || p.indexOf('399') >= 0) return 90;
  if (p.indexOf('2') >= 0 || p.indexOf('299') >= 0) return 60;
  return 30;
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

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const mobile = String(body.mobile || '').trim();
  const plan = String(body.plan || '').trim();
  const amount = parseInt(String(body.amount || '0').replace(/[^0-9]/g, ''), 10) || 0;
  const deviceId = String(body.deviceId || '').trim();
  const profileId = normalizeProfile(body.profileId);

  if (amount < 1) {
    return res.status(400).json({ ok: false, error: 'Invalid amount' });
  }
  if (!name) name = 'Customer';
  if (!email) email = 'user@gmax.app';
  if (!mobile) mobile = '9999999999';

  if (!KEY_ID || !KEY_SECRET) {
    return res.status(500).json({ ok: false, error: 'Razorpay keys not configured' });
  }

  const amountPaise = amount * 100;
  const receipt = 'gmax_' + Date.now().toString(36);
  const auth = Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64');

  let order;
  try {
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt,
        notes: {
          name,
          email,
          mobile,
          plan,
          profileId,
          deviceId
        }
      })
    });
    order = await r.json().catch(() => ({}));
    if (!r.ok || !order.id) {
      return res.status(400).json({
        ok: false,
        error: (order && order.error && order.error.description) || 'Order create failed'
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Razorpay network error' });
  }

  const localId = crypto.randomBytes(6).toString('hex');
  const record = {
    id: localId,
    razorpayOrderId: order.id,
    name,
    email,
    mobile,
    plan,
    amount: String(amount),
    deviceId,
    profileId,
    days: planDays(plan),
    status: 'created',
    method: 'razorpay',
    createdAt: new Date().toISOString()
  };
  try {
    await redisSet('gmax:pay:' + localId, record, 14 * 24 * 60 * 60);
    await redisSet('gmax:rzp_order:' + order.id, { localId, ...record }, 14 * 24 * 60 * 60);
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    keyId: KEY_ID,
    orderId: order.id,
    amount: amountPaise,
    currency: 'INR',
    localId: localId,
    name,
    email,
    mobile,
    plan,
    profileId
  });
};
