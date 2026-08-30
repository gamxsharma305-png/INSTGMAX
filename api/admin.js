const crypto = require('crypto');

// Per-instance failed attempts (warm instances). Client also enforces 2h lock.
const failsByKey = new Map();
const LOCK_MS = 2 * 60 * 60 * 1000;
const MAX_FAILS = 2;

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function clientKey(req, body) {
  const ip =
    (req.headers['x-forwarded-for'] && String(req.headers['x-forwarded-for']).split(',')[0].trim()) ||
    req.headers['x-real-ip'] ||
    'unknown';
  const device = String((body && body.deviceId) || 'nodevice').slice(0, 32);
  return `${ip}|${device}`;
}

function getLockState(key) {
  const row = failsByKey.get(key);
  if (!row) return { fails: 0, lockUntil: 0 };
  if (row.lockUntil && Date.now() < row.lockUntil) {
    return { fails: row.fails, lockUntil: row.lockUntil };
  }
  if (row.lockUntil && Date.now() >= row.lockUntil) {
    failsByKey.delete(key);
    return { fails: 0, lockUntil: 0 };
  }
  return { fails: row.fails || 0, lockUntil: 0 };
}

function recordFail(key) {
  const cur = getLockState(key);
  const fails = (cur.fails || 0) + 1;
  let lockUntil = 0;
  if (fails >= MAX_FAILS) {
    lockUntil = Date.now() + LOCK_MS;
  }
  failsByKey.set(key, { fails, lockUntil });
  return { fails, lockUntil };
}

function clearFails(key) {
  failsByKey.delete(key);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) return res.status(500).json({ ok: false, error: 'ADMIN_PIN not set on server' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const pin = String(body.pin || '');
  const key = clientKey(req, body);

  const state = getLockState(key);
  if (state.lockUntil && Date.now() < state.lockUntil) {
    const mins = Math.ceil((state.lockUntil - Date.now()) / 60000);
    return res.status(429).json({
      ok: false,
      locked: true,
      lockUntil: state.lockUntil,
      error: `Too many wrong PINs. Try again after ${mins} min (≈2 hours from lock).`,
    });
  }

  if (!pin) return res.status(400).json({ ok: false, error: 'PIN required' });

  const a = hashPin(pin);
  const b = hashPin(adminPin);
  if (a !== b) {
    const after = recordFail(key);
    if (after.lockUntil) {
      return res.status(429).json({
        ok: false,
        locked: true,
        lockUntil: after.lockUntil,
        fails: after.fails,
        error: 'Wrong PIN twice. Locked for 2 hours. Try again later.',
      });
    }
    return res.status(401).json({
      ok: false,
      fails: after.fails,
      remaining: Math.max(0, MAX_FAILS - after.fails),
      error: `Wrong PIN. ${Math.max(0, MAX_FAILS - after.fails)} attempt(s) left before 2-hour lock.`,
    });
  }

  clearFails(key);
  const token = crypto
    .createHmac('sha256', process.env.KEY_SECRET || adminPin)
    .update(`admin:${Date.now()}`)
    .digest('hex');
  return res.status(200).json({ ok: true, token, until: Date.now() + 12 * 60 * 60 * 1000 });
};
