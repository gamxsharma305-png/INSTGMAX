/**
 * POST /api/razorpay-webhook
 * Payment Page flow — no API keys.
 * Unlocks gmax:latest_pending:{amount} device (set when user taps Pay Now).
 */
const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
}

function durationSecFromAmount(amountRupees) {
  const a = parseInt(String(amountRupees).replace(/[^0-9]/g, ''), 10) || 0;
  if (a === 1) return 20 * 60;
  if (a >= 399) return 90 * 24 * 60 * 60;
  if (a >= 299) return 60 * 24 * 60 * 60;
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

async function redisDel(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return;
  try {
    await fetch(url + '/del/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (_) {}
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

async function activateDevice(pending, amountRupees, paymentId) {
  const deviceId = String(pending.deviceId || '');
  if (!deviceId) return null;
  const profileId = normalizeProfile(pending.profileId);
  const plan = pending.plan || planLabelFromAmount(amountRupees);
  const dur = pending.durationSec || durationSecFromAmount(amountRupees);
  const until = Date.now() + dur * 1000;
  const expSec = dur + 86400;
  const rec = {
    until,
    expiryTime: until,
    plan,
    profileId,
    amount: amountRupees,
    paymentId,
    method: 'payment_page'
  };
  await redisSet('sub:' + deviceId, rec, expSec);
  await redisSet('gmax:access:' + profileId + ':' + deviceId, rec, expSec);
  await redisSet(
    'gmax:plink_device:' + profileId + ':' + deviceId,
    { status: 'approved', until, plan, paymentId, ts: Date.now() },
    expSec
  );
  if (paymentId) {
    await redisSet(
      'gmax:rzp_paid:' + paymentId,
      { deviceId, profileId, at: Date.now() },
      30 * 24 * 60 * 60
    );
  }
  await redisIncr('gmax:stats:subs:' + profileId);
  await redisIncrBy('gmax:stats:revenue:' + profileId, amountRupees);
  return { deviceId, profileId, until, plan };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).send('OK');

  let event = {};
  try {
    event =
      typeof req.body === 'object' && req.body
        ? req.body
        : JSON.parse(typeof req.body === 'string' ? req.body : '{}');
  } catch (_) {
    event = {};
  }

  const eventName = String(event.event || '');
  const payload = event.payload || {};

  let amountPaise = 0;
  let paymentId = '';

  if (eventName === 'payment_link.paid' || payload.payment_link) {
    const pl = (payload.payment_link && payload.payment_link.entity) || {};
    const pay = (payload.payment && payload.payment.entity) || {};
    amountPaise = parseInt(pl.amount_paid || pl.amount || pay.amount || 0, 10) || 0;
    paymentId = String(pay.id || '');
  } else if (
    eventName === 'payment.captured' ||
    eventName === 'payment.authorized' ||
    payload.payment
  ) {
    const pay = (payload.payment && payload.payment.entity) || payload.payment || {};
    amountPaise = parseInt(pay.amount || 0, 10) || 0;
    paymentId = String(pay.id || '');
  } else {
    return res.status(200).json({ ok: true, ignored: eventName || 'unknown' });
  }

  const amountRupees = Math.round(amountPaise / 100);
  if (amountRupees > 0 && ![1, 199, 299, 399].includes(amountRupees)) {
    return res.status(200).json({ ok: true, ignored: 'amount', amountRupees });
  }

  if (paymentId) {
    const seen = await redisGet('gmax:rzp_paid:' + paymentId).catch(() => null);
    if (seen) {
      return res.status(200).json({ ok: true, duplicate: true, deviceId: seen.deviceId });
    }
  }

  // Unlock the device that last tapped Pay Now for this amount (within TTL)
  const pending = await redisGet('gmax:latest_pending:' + amountRupees).catch(() => null);
  if (pending && pending.deviceId) {
    const age = Date.now() - (pending.ts || 0);
    if (age < 45 * 60 * 1000) {
      const act = await activateDevice(pending, amountRupees, paymentId);
      await redisDel('gmax:latest_pending:' + amountRupees);
      if (BOT_TOKEN && CHAT_ID) {
        try {
          await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: CHAT_ID,
              text:
                'UNLOCK OK\n' +
                act.deviceId +
                '\nRs ' +
                amountRupees +
                '\n' +
                paymentId
            })
          });
        } catch (_) {}
      }
      return res.status(200).json({ ok: true, activated: true, method: 'latest_pending', ...act });
    }
  }

  if (BOT_TOKEN && CHAT_ID) {
    try {
      await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text:
            'Payment but no Pay Now pending\nRs ' +
            amountRupees +
            '\n' +
            paymentId
        })
      });
    } catch (_) {}
  }

  return res.status(200).json({
    ok: true,
    noPending: true,
    paymentId,
    amountRupees,
    hint: 'Tap Pay Now on website first, then pay within 45 minutes'
  });
};
