/**
 * GET /api/stats
 * Header: x-admin-pin: <ADMIN_PIN>
 * Returns unique unlock users: today + this month
 * Count only happens on successful /api/verify (not page visits)
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const pin = String(req.headers['x-admin-pin'] || '');
  const adminPin = String(process.env.ADMIN_PIN || '');
  if (!adminPin || pin !== adminPin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  if (!url || !token) return res.status(500).json({ error: 'Redis missing' });

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const headers = { Authorization: 'Bearer ' + token };

  async function scard(key) {
    const r = await fetch(url + '/scard/' + encodeURIComponent(key), { headers });
    const j = await r.json().catch(() => ({}));
    return Number(j.result || 0);
  }

  try {
    const today = await scard('gmax:stats:day:' + day);
    const monthCount = await scard('gmax:stats:month:' + month);
    return res.status(200).json({
      ok: true,
      today: today,
      month: monthCount,
      dayKey: day,
      monthKey: month
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
