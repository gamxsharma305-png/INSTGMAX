/**
 * POST /api/razorpay-webhook
 * Payment Page / Link — NO Razorpay API keys required.
 * payment.captured | payment_link.paid
 * Unlocks device via pending queue (solo-safe) + stores claim record.
 */
const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
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

async function redisRpop(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return null;
  const r = await fetch(url + '/rpop/' + encodeURIComponent(key), {
    method: 'POST',
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

async function redisLlen(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return 0;
  const r = await fetch(url + '/llen/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  const n = parseInt(j.result, 10);
  return Number.isFinite(n) ? n : 0;
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

function getRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
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
      'gmax:rzp_claim:' + paymentId,
      Object.assign({}, rec, { claimedBy: deviceId, paymentId }),
      30 * 24 * 60 * 60
    );
    await redisSet('gmax:rzp_paid:' + paymentId, { deviceId, profileId, at: Date.now() }, 30 * 24 * 60 * 60);
  }
  await redisIncr('gmax:stats:subs:' + profileId);
  await redisIncrBy('gmax:stats:revenue:' + profileId, amountRupees);
  return { deviceId, profileId, until, plan };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const raw = getRawBody(req);
  let event = {};
  try {
    event = typeof req.body === 'object' && req.body ? req.body : JSON.parse(raw || '{}');
  } catch (_) {
    event = {};
  }

  if (WEBHOOK_SECRET) {
    const sig = String(req.headers['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!sig || sig !== expected) {
      // Razorpay Dashboard secret must EXACTLY match Vercel RAZORPAY_WEBHOOK_SECRET
      return res.status(400).json({
        ok: false,
        error: 'Invalid signature — fix RAZORPAY_WEBHOOK_SECRET in Vercel to match Razorpay webhook secret'
      });
    }
  }

  const eventName = String(event.event || '');
  const payload = event.payload || {};

  let amountPaise = 0;
  let paymentId = '';
  let notes = {};

  if (eventName === 'payment_link.paid' || payload.payment_link) {
    const pl = (payload.payment_link && payload.payment_link.entity) || {};
    const pay = (payload.payment && payload.payment.entity) || {};
    amountPaise = parseInt(pl.amount_paid || pl.amount || pay.amount || 0, 10) || 0;
    paymentId = String(pay.id || '');
    notes = pl.notes || pay.notes || {};
  } else if (eventName === 'payment.captured' || payload.payment) {
    const pay = (payload.payment && payload.payment.entity) || payload.payment || {};
    amountPaise = parseInt(pay.amount || 0, 10) || 0;
    paymentId = String(pay.id || '');
    notes = pay.notes || {};
  } else {
    return res.status(200).json({ ok: true, ignored: eventName || 'unknown' });
  }

  if (typeof notes === 'string') {
    try {
      notes = JSON.parse(notes);
    } catch (_) {
      notes = {};
    }
  }

  const amountRupees = Math.round(amountPaise / 100);
  if (![1, 199, 299, 399].includes(amountRupees)) {
    return res.status(200).json({ ok: true, ignored: 'amount', amountRupees });
  }

  if (paymentId) {
    const seen = await redisGet('gmax:rzp_paid:' + paymentId).catch(() => null);
    if (seen) return res.status(200).json({ ok: true, duplicate: true });
  }

  // If notes somehow have device_id (rare on pages) use it
  const noteDevice = String((notes && (notes.device_id || notes.deviceId)) || '').trim();
  if (noteDevice) {
    const act = await activateDevice(
      {
        deviceId: noteDevice,
        profileId: notes.profileId || 'gmax',
        plan: notes.plan || planLabelFromAmount(amountRupees),
        durationSec: durationSecFromAmount(amountRupees)
      },
      amountRupees,
      paymentId
    );
    return res.status(200).json({ ok: true, activated: true, method: 'notes', ...act });
  }

  // One successful payment → unlock ONE pending (oldest in queue for this amount).
  // User must click Pay Now on site before paying (creates pending).
  const q = 'gmax:plink_pending:' + amountRupees;
  const len = await redisLlen(q);
  const pending = await redisRpop(q);
  if (pending && pending.deviceId) {
    const act = await activateDevice(pending, amountRupees, paymentId);
    if (BOT_TOKEN && CHAT_ID) {
      try {
        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text:
              'Payment Page unlock\n' +
              act.deviceId +
              '\nRs ' +
              amountRupees +
              '\n' +
              paymentId +
              '\nqueueLeft:' +
              Math.max(0, len - 1)
          })
        });
      } catch (_) {}
    }
    return res.status(200).json({
      ok: true,
      activated: true,
      method: 'pending_queue',
      queueLeft: Math.max(0, len - 1),
      ...act
    });
  }

  // No pending: user paid without Pay Now on site — store claimable
  if (paymentId) {
    await redisSet(
      'gmax:rzp_claim:' + paymentId,
      {
        paymentId,
        amount: amountRupees,
        plan: planLabelFromAmount(amountRupees),
        durationSec: durationSecFromAmount(amountRupees),
        claimedBy: null,
        at: new Date().toISOString()
      },
      7 * 24 * 60 * 60
    );
  }

  return res.status(200).json({
    ok: true,
    noPending: true,
    paymentId,
    amountRupees,
    hint: 'User must tap Pay Now on website before paying'
  });
};
