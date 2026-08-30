const crypto = require('crypto');

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
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
  const pin = String((body && body.pin) || '');
  if (!pin) return res.status(400).json({ ok: false, error: 'PIN required' });

  // constant-time-ish compare via hash
  const a = hashPin(pin);
  const b = hashPin(adminPin);
  if (a !== b) return res.status(401).json({ ok: false, error: 'Wrong PIN' });

  const token = crypto
    .createHmac('sha256', process.env.KEY_SECRET || adminPin)
    .update(`admin:${Date.now()}`)
    .digest('hex');
  return res.status(200).json({ ok: true, token, until: Date.now() + 12 * 60 * 60 * 1000 });
};
