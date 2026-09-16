/**
 * GET  /api/profiles              → list profiles + public names
 * GET  /api/profiles?stats=1&pin= → admin stats (needs ADMIN_PIN)
 * POST /api/profiles              → update display name { pin, profileId, name }
 */
const crypto = require('crypto');

const DEFAULTS = {
  gmax: { id: 'gmax', name: 'GMAX Hub', tag: 'Gated feed' },
  edu: { id: 'edu', name: 'प्रीति सिंह', tag: 'Gated feed' }
};

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function checkAdmin(pin) {
  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) return false;
  return hashPin(String(pin || '')) === hashPin(adminPin);
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
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  return typeof v === 'object' && v ? v : null;
}

async function redisSet(key, value) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  const r = await fetch(
    url + '/set/' + encodeURIComponent(key) + '/' + encodeURIComponent(JSON.stringify(value)),
    { method: 'POST', headers: { Authorization: 'Bearer ' + token } }
  );
  return r.ok;
}

async function redisGetNum(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return 0;
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  const n = parseInt(j.result, 10);
  return Number.isFinite(n) ? n : 0;
}

function mergeMeta(stored) {
  const out = {
    gmax: Object.assign({}, DEFAULTS.gmax),
    edu: Object.assign({}, DEFAULTS.edu)
  };
  if (stored && typeof stored === 'object') {
    ['gmax', 'edu'].forEach((id) => {
      if (stored[id] && typeof stored[id] === 'object') {
        if (stored[id].name) out[id].name = String(stored[id].name);
        if (stored[id].tag) out[id].tag = String(stored[id].tag);
      }
    });
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const stored = await redisGet('gmax:profiles:meta').catch(() => null);
    const profiles = mergeMeta(stored);
    const list = [profiles.gmax, profiles.edu];

    const wantStats = String((req.query && req.query.stats) || '') === '1';
    const pin = String((req.query && req.query.pin) || '');

    if (wantStats) {
      if (!checkAdmin(pin)) {
        return res.status(401).json({ ok: false, error: 'Admin PIN required' });
      }
      const stats = {};
      for (const id of ['gmax', 'edu']) {
        const subs = await redisGetNum('gmax:stats:subs:' + id);
        const views = await redisGetNum('gmax:stats:views:' + id);
        stats[id] = {
          name: profiles[id].name,
          subscriptions: subs,
          views: views
        };
      }
      return res.status(200).json({ ok: true, profiles: list, stats: stats });
    }

    return res.status(200).json({ ok: true, profiles: list });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};
    if (!checkAdmin(body.pin)) {
      return res.status(401).json({ ok: false, error: 'Admin PIN required' });
    }
    const profileId = String(body.profileId || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const stored = (await redisGet('gmax:profiles:meta').catch(() => null)) || {};
    if (!stored[profileId]) stored[profileId] = {};
    stored[profileId].name = name;
    if (body.tag != null) stored[profileId].tag = String(body.tag);

    await redisSet('gmax:profiles:meta', stored);
    const profiles = mergeMeta(stored);
    return res.status(200).json({ ok: true, profiles: [profiles.gmax, profiles.edu] });
  }

  return res.status(405).json({ ok: false, error: 'GET or POST only' });
};
