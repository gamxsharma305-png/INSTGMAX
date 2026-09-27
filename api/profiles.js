/**
 * GET  /api/profiles
 * GET  /api/profiles?profileId=gmax&publicStats=1  → posts not here; subs + followers
 * POST { action:'follow', profileId, deviceId }
 * POST { action:'view', profileId }  (optional view counter)
 * POST admin: { pin, profileId, name, tag }
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

function normalizeProfile(id) {
  return String(id || '').toLowerCase() === 'edu' ? 'edu' : 'gmax';
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
    encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
  if (expSeconds) path += '?EX=' + expSeconds;
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  return r.ok;
}

async function redisGetNum(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return 0;
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (j.result == null || j.result === '') return 0;
  const n = parseInt(j.result, 10);
  return Number.isFinite(n) ? n : 0;
}

async function redisIncr(key) {
  const { url, token } = redisEnv();
  if (!url || !token) return 0;
  const r = await fetch(url + '/incr/' + encodeURIComponent(key), {
    method: 'POST',
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
    const q = req.query || {};
    const profileId = normalizeProfile(q.profileId);

    const publicStats = String(q.publicStats || '') === '1' || String(q.stats) === 'public';
    if (publicStats || q.profileId) {
      const subs = await redisGetNum('gmax:stats:subs:' + profileId);
      const followers = await redisGetNum('gmax:stats:followers:' + profileId);
      return res.status(200).json({
        ok: true,
        profiles: list,
        profileId,
        subscribers: subs,
        followers: followers
      });
    }

    const wantStats = String(q.stats || '') === '1';
    const pin = String(q.pin || '');
    if (wantStats) {
      if (!checkAdmin(pin)) {
        return res.status(401).json({ ok: false, error: 'Admin PIN required' });
      }
      const stats = {};
      for (const id of ['gmax', 'edu']) {
        const subs = await redisGetNum('gmax:stats:subs:' + id);
        const views = await redisGetNum('gmax:stats:views:' + id);
        const followers = await redisGetNum('gmax:stats:followers:' + id);
        stats[id] = {
          name: profiles[id].name,
          subscriptions: subs,
          views: views,
          followers: followers
        };
      }
      return res.status(200).json({ ok: true, profiles: list, stats: stats });
    }

    return res.status(200).json({ ok: true, profiles: list });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    }
    body = body || {};
    const action = String(body.action || '').toLowerCase();

    if (action === 'follow') {
      const profileId = normalizeProfile(body.profileId);
      const deviceId = String(body.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
      const flagKey = 'gmax:followed:' + profileId + ':' + deviceId;
      const already = await redisGet(flagKey).catch(() => null);
      if (already) {
        const followers = await redisGetNum('gmax:stats:followers:' + profileId);
        return res.status(200).json({ ok: true, already: true, followers: followers });
      }
      await redisSet(flagKey, { at: Date.now() }, 365 * 24 * 60 * 60);
      const followers = await redisIncr('gmax:stats:followers:' + profileId);
      return res.status(200).json({ ok: true, followed: true, followers: followers });
    }

    if (action === 'view') {
      const profileId = normalizeProfile(body.profileId);
      const views = await redisIncr('gmax:stats:views:' + profileId);
      return res.status(200).json({ ok: true, views: views });
    }

    if (action === 'like') {
      const profileId = normalizeProfile(body.profileId);
      const postId = String(body.postId || '').trim();
      const deviceId = String(body.deviceId || '').trim();
      if (!postId || !deviceId) {
        return res.status(400).json({ ok: false, error: 'postId and deviceId required' });
      }
      const likeFlag = 'gmax:liked:' + profileId + ':' + postId + ':' + deviceId;
      const already = await redisGet(likeFlag).catch(() => null);
      if (already) {
        const n = await redisGetNum('gmax:likes:' + profileId + ':' + postId);
        return res.status(200).json({ ok: true, already: true, likes: n });
      }
      await redisSet(likeFlag, { at: Date.now() }, 365 * 24 * 60 * 60);
      const likes = await redisIncr('gmax:likes:' + profileId + ':' + postId);
      return res.status(200).json({ ok: true, liked: true, likes: likes });
    }

    // Admin rename
    if (!checkAdmin(body.pin)) {
      return res.status(401).json({ ok: false, error: 'Admin PIN required' });
    }
    const profileId = normalizeProfile(body.profileId);
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
