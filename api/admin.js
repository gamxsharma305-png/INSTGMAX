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

  try {
    const adminPin = process.env.ADMIN_PIN;
    if (!adminPin) {
      return res.status(500).json({
        ok: false,
        error: 'ADMIN_PIN Vercel env \u092e\u0947\u0902 set \u0928\u0939\u0940\u0902 \u0939\u0948'
      });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    }
    body = body || {};
    const pin = String(body.pin || '');

    if (!pin) {
      return res.status(400).json({ ok: false, error: 'PIN required' });
    }

    const a = hashPin(pin);
    const b = hashPin(adminPin);
    if (a !== b) {
      return res.status(401).json({
        ok: false,
        error: 'Wrong PIN. Vercel \u2192 Settings \u2192 Environment Variables \u2192 ADMIN_PIN \u091a\u0947\u0915 \u0915\u0930\u094b\u0964'
      });
    }

    return res.status(200).json({
      ok: true,
      until: Date.now() + 12 * 60 * 60 * 1000
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: 'Server: ' + String(e && e.message ? e.message : e)
    });
  }
};
