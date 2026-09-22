/**
 * POST /api/razorpay-webhook
 * Handles payment_link.paid (and payment.captured fallback)
 * Matches static Payment Link payments to pending device/profile via amount queue.
 *
 * Env: RAZORPAY_WEBHOOK_SECRET (recommended), UPSTASH_*, optional TELEGRAM_*, SHEET_WEBAPP_URL
 */
const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SHEET_WEBAPP = process.env.SHEET_WEBAPP_URL || '';

function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
}

function planDaysFromAmount(amountRupees) {
  const a = parseInt(String(amountRupees).replace(/[^0-9]/g, ''), 10) || 0;
  if (a === 1) return 0;
  if (a >= 399) return 90;
  if (a >= 299) return 60;
  return 30;
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const raw = getRawBody(req);
  let event = {};
  try {
    event = typeof req.body === 'object' && req.body ? req.body : JSON.parse(raw || '{}');
  } catch (_) {
    event = {};
  }

  // Signature verify (if secret configured)
  if (WEBHOOK_SECRET) {
    const sig = String(req.headers['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!sig || sig !== expected) {
      return res.status(400).json({ ok: false, error: 'Invalid signature' });
    }
  }

  const eventName = String(event.event || '');
  const payload = event.payload || {};

  // Extract amount (paise) + payment ids from payment_link.paid or payment.captured
  let amountPaise = 0;
  let paymentId = '';
  let linkId = '';

  if (eventName === 'payment_link.paid' || payload.payment_link) {
    const pl = (payload.payment_link && payload.payment_link.entity) || {};
    const pay = (payload.payment && payload.payment.entity) || {};
    amountPaise = parseInt(pl.amount_paid || pl.amount || pay.amount || 0, 10) || 0;
    paymentId = String(pay.id || pl.id || '');
    linkId = String(pl.id || '');
  } else if (eventName === 'payment.captured' || payload.payment) {
    const pay = (payload.payment && payload.payment.entity) || payload.payment || {};
    amountPaise = parseInt(pay.amount || 0, 10) || 0;
    paymentId = String(pay.id || '');
  } else {
    // ignore other events
    return res.status(200).json({ ok: true, ignored: eventName || 'unknown' });
  }

  const amountRupees = Math.round(amountPaise / 100);
  if (![1, 199, 299, 399].includes(amountRupees)) {
    return res.status(200).json({ ok: true, ignored: 'amount', amountRupees });
  }

  // Idempotency
  if (paymentId) {
    const seen = await redisGet('gmax:rzp_paid:' + paymentId).catch(() => null);
    if (seen) return res.status(200).json({ ok: true, duplicate: true });
  }

  const durationSec = durationSecFromAmount(amountRupees);
  const planDefault = planLabelFromAmount(amountRupees);

  // Always store as CLAIMABLE — correct user binds via /api/claim-payment
  const claimRec = {
    paymentId: paymentId,
    linkId: linkId,
    amount: amountRupees,
    plan: planDefault,
    durationSec: durationSec,
    claimedBy: null,
    at: new Date().toISOString()
  };
  try {
    if (paymentId) {
      await redisSet('gmax:rzp_claim:' + paymentId, claimRec, 30 * 24 * 60 * 60);
      await redisSet('gmax:rzp_paid:' + paymentId, { at: Date.now(), amount: amountRupees }, 30 * 24 * 60 * 60);
    }
  } catch (_) {}

  // Auto-unlock ONLY if exactly ONE pending for this amount (safe solo case).
  // If 0 or 2+ pendings → do NOT guess; user must claim with Payment ID.
  let pending = null;
  let auto = false;
  try {
    const q = 'gmax:plink_pending:' + amountRupees;
    const len = await redisLlen(q);
    if (len === 1) {
      pending = await redisRpop(q);
      auto = !!(pending && pending.deviceId);
    }
  } catch (_) {}

  if (!auto) {
    try {
      await redisSet(
        'gmax:rzp_unmatched:' + (paymentId || Date.now()),
        { amountRupees, paymentId, linkId, at: new Date().toISOString(), needClaim: true },
        7 * 24 * 60 * 60
      );
    } catch (_) {}
    // Telegram notify claim needed
    if (BOT_TOKEN && CHAT_ID && paymentId) {
      try {
        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text:
              'Payment received (claim needed)\nRs ' +
              amountRupees +
              '\nPayment ID: ' +
              paymentId +
              '\nUser must enter this ID on site to unlock their device.'
          })
        });
      } catch (_) {}
    }
    return res.status(200).json({
      ok: true,
      stored: true,
      needClaim: true,
      paymentId: paymentId,
      amountRupees: amountRupees
    });
  }

  const deviceId = String(pending.deviceId || '');
  const profileId = normalizeProfile(pending.profileId);
  const plan = pending.plan || planDefault;
  const dur =
    pending.durationSec ||
    durationSec ||
    30 * 24 * 60 * 60;
  const until = Date.now() + dur * 1000;
  const expSec = dur + 86400;

  try {
    await redisSet(
      'gmax:access:' + profileId + ':' + deviceId,
      {
        until,
        plan,
        profileId,
        method: 'payment_link_auto',
        paymentId,
        amount: amountRupees
      },
      expSec
    );
    if (pending.id) {
      await redisSet(
        'gmax:pay:' + pending.id,
        Object.assign({}, pending, {
          status: 'approved',
          until,
          paymentId,
          approvedAt: new Date().toISOString()
        }),
        14 * 24 * 60 * 60
      );
    }
    await redisSet(
      'gmax:plink_device:' + profileId + ':' + deviceId,
      { status: 'approved', until, plan, paymentId, ts: Date.now() },
      expSec
    );
    if (paymentId) {
      await redisSet(
        'gmax:rzp_claim:' + paymentId,
        Object.assign({}, claimRec, {
          claimedBy: deviceId,
          profileId,
          plan,
          until,
          claimedAt: new Date().toISOString()
        }),
        30 * 24 * 60 * 60
      );
    }
    await redisIncr('gmax:stats:subs:' + profileId);
    await redisIncrBy('gmax:stats:revenue:' + profileId, amountRupees);
  } catch (_) {}

  // Sheet (optional)
  if (SHEET_WEBAPP) {
    try {
      const qs = new URLSearchParams({
        action: 'approve',
        name: pending.name || '',
        email: pending.email || '',
        mobile: pending.mobile || '',
        utr: paymentId || linkId,
        plan,
        amount: String(amountRupees),
        days: String(days),
        profile: profileId,
        method: 'payment_link'
      });
      await fetch(SHEET_WEBAPP + '?' + qs.toString(), { redirect: 'follow' });
    } catch (_) {}
  }

  // Telegram notify (optional)
  if (BOT_TOKEN && CHAT_ID) {
    try {
      await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text:
            'Payment Link PAID\n\nProfile: ' +
            profileId +
            '\nPlan: ' +
            plan +
            ' (Rs ' +
            amountRupees +
            ')\nDevice: ' +
            deviceId +
            '\nPayment: ' +
            paymentId
        })
      });
    } catch (_) {}
  }

  return res.status(200).json({ ok: true, activated: true, profileId, deviceId, until });
};
