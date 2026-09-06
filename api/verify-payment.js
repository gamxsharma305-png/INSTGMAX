/**
 * POST /api/verify-payment
 * Verifies Razorpay signature → issues 12-digit code bound to device (30 days)
 */
const crypto = require('crypto');
const PASS_PREFIX = 'lumina:pass:';

function deviceSafe(id) {
  const s = String(id || 'XXXX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return (s + 'XXXXXXXXXXXX').slice(0, 12);
}

function makeMonthCode(deviceId, paymentId, secret) {
  const h = crypto
    .createHmac('sha256', secret)
    .update('month:' + deviceSafe(deviceId) + ':' + String(paymentId))
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

async function redisSet(key, value, expSeconds) {
  const { url, token } = redisEnv();
  if (!url || !token) throw new Error('Upstash Redis env missing');
  const path =
    url +
    '/set/' +
    encodeURIComponent(key) +
    '/' +
    encodeURIComponent(JSON.stringify(value)) +
    (expSeconds ? '?EX=' + expSeconds : '');
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Redis SET failed: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const signSecret = process.env.KEY_SECRET || keySecret;
  if (!keySecret) return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET missing' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const orderId = String(body.razorpay_order_id || '');
  const paymentId = String(body.razorpay_payment_id || '');
  const signature = String(body.razorpay_signature || '');
  const deviceId = deviceSafe(body.deviceId);

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ ok: false, error: 'Missing payment fields' });
  }

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(orderId + '|' + paymentId)
    .digest('hex');

  if (expected !== signature) {
    return res.status(400).json({ ok: false, error: 'Invalid payment signature' });
  }

  const code = makeMonthCode(deviceId, paymentId, signSecret);
  const until = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const expSec = 31 * 24 * 60 * 60;

  const record = {
    plan: 'month',
    deviceId: deviceId,
    until: until,
    paymentId: paymentId,
    orderId: orderId,
    amount: 19900,
    createdAt: new Date().toISOString()
  };

  try {
    await redisSet(PASS_PREFIX + code, record, expSec);
    await redisSet(PASS_PREFIX + 'device:' + deviceId, { code: code, until: until }, expSec);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }

  return res.status(200).json({
    ok: true,
    code: code,
    until: until,
    plan: 'month',
    days: 30,
    message: 'Payment OK. Code sirf is device par 30 din chalega.'
  });
};
