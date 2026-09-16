/**
 * Profile-scoped content — Upstash Redis REST
 * GET  /api/content?profileId=gmax|edu
 * POST /api/content  body includes profileId + pin + posts/stories/brand
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ADMIN_PIN
 */
const crypto = require('crypto');

const LEGACY_KEY = 'lumina:content:v1';

function contentKey(profileId) {
  return 'lumina:content:v1:' + profileId;
}

function normalizeProfile(id) {
  const p = String(id || 'gmax').toLowerCase().trim();
  return p === 'edu' ? 'edu' : 'gmax';
}

const DEFAULT_BRAND = {
  gmax: { name: 'GMAX Hub', tag: 'Study feed · gated classroom', logo: '', avatar: '' },
  edu: { name: 'प्रीति सिंह', tag: 'Study feed · gated classroom', logo: '', avatar: '' }
};

function makeDefault(profileId) {
  const brand = DEFAULT_BRAND[profileId] || DEFAULT_BRAND.gmax;
  return {
    posts: [],
    stories: [],
    about: [
      {
        badge: 'Slide 1 · Mentor',
        title: 'Learn with a clear, calm feed',
        body: 'Stories + posts for your classroom.',
        bullets: ['Daily tips', 'Notes & revisions', 'Like & share']
      },
      {
        badge: 'Slide 2 · Access',
        title: 'Private until you unlock',
        body: 'Subscribe to unlock this profile feed.',
        bullets: ['Choose plan', 'Pay UPI', 'Get access']
      },
      {
        badge: 'Slide 3 · Profile',
        title: brand.name,
        body: 'Content for this profile only after unlock.',
        bullets: ['Profile locked', 'Separate plans', 'Your data only']
      }
    ],
    brand: Object.assign({}, brand),
    profileId: profileId,
    updatedAt: null
  };
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function checkAdmin(body) {
  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) return false;
  const pin = String((body && body.pin) || '');
  if (!pin) return false;
  return hashPin(pin) === hashPin(adminPin);
}

function redisEnv() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  return { url, token };
}

function parseRedisResult(result) {
  let v = result;
  for (let i = 0; i < 4; i++) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v !== 'string') break;
    const s = v.trim();
    if (!s) return null;
    try {
      v = JSON.parse(s);
    } catch (_) {
      return null;
    }
  }
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v;
  return null;
}

async function redisGetKey(key) {
  const { url, token } = redisEnv();
  if (!url || !token) {
    return { error: 'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing in Vercel env' };
  }
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { error: 'Redis GET ' + r.status + ': ' + JSON.stringify(j).slice(0, 200) };
  }
  if (j.result == null || j.result === '') {
    return { data: null };
  }
  const parsed = parseRedisResult(j.result);
  if (!parsed) {
    return { error: 'Redis value could not be parsed as JSON object' };
  }
  return { data: parsed };
}

async function redisSetKey(key, obj) {
  const { url, token } = redisEnv();
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing in Vercel env');
  }
  const r = await fetch(url + '/set/' + encodeURIComponent(key), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(obj)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error('Redis SET ' + r.status + ': ' + JSON.stringify(j).slice(0, 250));
  }
  return j;
}

function normalize(c, profileId) {
  c = c && typeof c === 'object' ? c : {};
  const def = makeDefault(profileId);
  return {
    posts: Array.isArray(c.posts) ? c.posts : [],
    stories: Array.isArray(c.stories) ? c.stories : [],
    about: Array.isArray(c.about) && c.about.length ? c.about : def.about,
    brand:
      c.brand && typeof c.brand === 'object'
        ? {
            name: String(c.brand.name || def.brand.name),
            tag: String(c.brand.tag || def.brand.tag),
            logo: String(c.brand.logo || ''),
            avatar: String(c.brand.avatar || '')
          }
        : def.brand,
    profileId: profileId,
    updatedAt: c.updatedAt || null
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.end();
    }

    if (req.method === 'GET') {
      const profileId = normalizeProfile(req.query && req.query.profileId);
      let got = await redisGetKey(contentKey(profileId));

      // Migrate: old single feed → gmax
      if ((!got.data || got.error) && profileId === 'gmax') {
        const legacy = await redisGetKey(LEGACY_KEY);
        if (legacy.data) got = legacy;
      }

      if (got.error && !got.data) {
        return send(res, 200, {
          ok: true,
          content: makeDefault(profileId),
          source: 'default',
          profileId: profileId,
          warn: got.error
        });
      }
      if (!got.data) {
        return send(res, 200, {
          ok: true,
          content: makeDefault(profileId),
          source: 'empty',
          profileId: profileId
        });
      }
      return send(res, 200, {
        ok: true,
        content: normalize(got.data, profileId),
        source: 'upstash',
        profileId: profileId
      });
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

      if (!checkAdmin(body)) {
        return send(res, 401, { ok: false, error: 'Admin PIN required / wrong PIN' });
      }

      const profileId = normalizeProfile(body.profileId);
      const { url, token } = redisEnv();
      if (!url || !token) {
        return send(res, 500, {
          ok: false,
          error: 'UPSTASH_REDIS_REST_URL और UPSTASH_REDIS_REST_TOKEN Vercel env में जोड़ो, फिर Redeploy।'
        });
      }

      const contentObj = normalize(
        {
          posts: body.posts,
          stories: body.stories,
          about: body.about,
          brand: body.brand
        },
        profileId
      );
      contentObj.updatedAt = new Date().toISOString();

      try {
        await redisSetKey(contentKey(profileId), contentObj);
        // Keep legacy key in sync for gmax (old clients)
        if (profileId === 'gmax') {
          try {
            await redisSetKey(LEGACY_KEY, contentObj);
          } catch (_) {}
        }
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
      }

      return send(res, 200, {
        ok: true,
        content: contentObj,
        source: 'upstash',
        profileId: profileId,
        counts: {
          posts: (contentObj.posts || []).length,
          stories: (contentObj.stories || []).length
        }
      });
    }

    return send(res, 405, { error: 'GET or POST only' });
  } catch (e) {
    return send(res, 500, {
      ok: false,
      error: 'Server: ' + String(e && e.message ? e.message : e)
    });
  }
};
