/**
 * POST /api/verify-payment
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, localId? }
 * Verifies signature and unlocks device for profile
 */
const crypto = require('crypto');

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'jImRQcWV2EA2vY6fdq69zbgY';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8654144417:AAH-RzyTAYavTNRk-cHbVzoxKMX_KKCgOGI';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8276743517';
const SHEET_WEBAPP =
  process.env.SHEET_WEBAPP_URL ||
  'https://script.google.com/macros/s/AKfycbznvyS8EYSRIQUwnE6mvExjAIZEKEJwPauczIRvY32T5AcOn_bJTtvWmkXcldUXgnBZ/exec';

function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
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

  const orderId = String(body.razorpay_order_id || '').trim();
  const paymentId = String(body.razorpay_payment_id || '').trim();
  const signature = String(body.razorpay_signature || '').trim();
  const localIdHint = String(body.localId || '').trim();

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ ok: false, error: 'Missing payment fields' });
  }

  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(orderId + '|' + paymentId)
    .digest('hex');

  if (expected !== signature) {
    return res.status(400).json({ ok: false, error: 'Invalid payment signature' });
  }

  let rec = (await redisGet('gmax:rzp_order:' + orderId).catch(() => null)) || {};
  if (!rec.localId && localIdHint) {
    rec = (await redisGet('gmax:pay:' + localIdHint).catch(() => null)) || rec;
  }

  const name = rec.name || '';
  const email = rec.email || '';
  const mobile = rec.mobile || '';
  const plan = rec.plan || '';
  const amount = rec.amount || '0';
  const deviceId = rec.deviceId || '';
  const profileId = normalizeProfile(rec.profileId);
  const days = parseInt(rec.days, 10) || 30;
  const until = Date.now() + days * 24 * 60 * 60 * 1000;
  const expSec = days * 24 * 60 * 60 + 86400;
  const localId = rec.localId || localIdHint || orderId;

  try {
    await redisSet(
      'gmax:pay:' + localId,
      Object.assign({}, rec, {
        status: 'approved',
        method: 'razorpay',
        razorpay_payment_id: paymentId,
        until: until,
        approvedAt: new Date().toISOString()
      }),
      14 * 24 * 60 * 60
    );
  } catch (_) {}

  if (deviceId) {
    try {
      await redisSet(
        'gmax:access:' + profileId + ':' + deviceId,
        {
          until: until,
          plan: plan,
          days: days,
          email: email,
          profileId: profileId,
          method: 'razorpay',
          paymentId: paymentId
        },
        expSec
      );
    } catch (_) {}
  }

  try {
    await redisIncr('gmax:stats:subs:' + profileId);
    const amt = parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 0;
    if (amt > 0) await redisIncrBy('gmax:stats:revenue:' + profileId, amt);
  } catch (_) {}

  try {
    const qs = new URLSearchParams({
      action: 'approve',
      name,
      email,
      mobile,
      utr: paymentId,
      plan,
      amount: String(amount),
      days: String(days),
      profile: profileId,
      method: 'razorpay'
    });
    await fetch(SHEET_WEBAPP + '?' + qs.toString(), { redirect: 'follow' });
  } catch (_) {}

  try {
    await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text:
          'Razorpay AUTO-PAID\n\n' +
          'Profile: ' +
          profileId +
          '\nName: ' +
          name +
          '\nEmail: ' +
          email +
          '\nMobile: ' +
          mobile +
          '\nPlan: ' +
          plan +
          ' (Rs ' +
          amount +
          ')\nPayment: ' +
          paymentId +
          '\nOrder: ' +
          orderId
      })
    });
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    status: 'approved',
    until: until,
    plan: plan,
    profileId: profileId
  });
};
