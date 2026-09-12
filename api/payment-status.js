/**
 * GET /api/payment-status?id=xxxx
 * GET /api/payment-status?deviceId=XXXX
 */
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
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  return typeof v === 'object' && v ? v : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const q = req.query || {};
  const id = String(q.id || '').trim();
  const deviceId = String(q.deviceId || '').trim();

  if (id) {
    const rec = await redisGet('gmax:pay:' + id).catch(() => null);
    if (!rec) return res.status(200).json({ ok: true, status: 'not_found' });
    return res.status(200).json({
      ok: true,
      status: rec.status || 'pending',
      until: rec.until || 0,
      plan: rec.plan || null
    });
  }

  if (deviceId) {
    const rec = await redisGet('gmax:access:' + deviceId).catch(() => null);
    if (!rec || !rec.until || rec.until < Date.now()) {
      return res.status(200).json({ ok: true, status: 'none', until: 0 });
    }
    return res.status(200).json({
      ok: true,
      status: 'approved',
      until: rec.until,
      plan: rec.plan || null
    });
  }

  return res.status(400).json({ ok: false, error: 'id or deviceId required' });
};
