/**
 * POST /api/create-order
 * Body: { deviceId }
 * ₹199 monthly pass — 1 device
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing in Vercel env' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const deviceId = String(body.deviceId || 'UNKNOWN')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'UNKNOWN';

  const amountPaise = 19900; // ₹199

  try {
    const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: 'month_' + deviceId.slice(0, 8) + '_' + Date.now().toString(36),
        notes: { deviceId: deviceId, plan: 'month' }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({ error: data.error?.description || 'Order failed', detail: data });
    }
    return res.status(200).json({
      ok: true,
      orderId: data.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: keyId,
      deviceId: deviceId
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
