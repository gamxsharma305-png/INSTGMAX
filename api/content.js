/**
 * Permanent shared content — Upstash Redis REST
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ADMIN_PIN
 */
const crypto = require('crypto');

const KEY = 'lumina:content:v1';

const DEFAULT = {
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
      body: 'Blurred until 12-digit key. Valid 36 hours.',
      bullets: ['Get Key', 'Copy code', 'Verify']
    },
    {
      badge: 'Slide 3 · Educators',
      title: 'Built for your classroom',
      body: 'Deploy on Vercel. Share one link.',
      bullets: ['Admin on server', 'Shared feed', 'Mobile first']
    }
  ],
  brand: {
    name: 'GMAX Hub',
    tag: 'Study feed · gated classroom',
    logo: '',
    avatar: ''
  },
  updatedAt: null
};

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

/** Upstash may return value as object or 1–2x JSON string */
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

async function redisGet() {
  const { url, token } = redisEnv();
  if (!url || !token) {
    return { error: 'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing in Vercel env' };
  }
  const r = await fetch(url + '/get/' + encodeURIComponent(KEY), {
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

async function redisSet(obj) {
  const { url, token } = redisEnv();
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing in Vercel env');
  }
  const r = await fetch(url + '/set/' + encodeURIComponent(KEY), {
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

function normalize(c) {
  c = c && typeof c === 'object' ? c : {};
  return {
    posts: Array.isArray(c.posts) ? c.posts : [],
    stories: Array.isArray(c.stories) ? c.stories : [],
    about: Array.isArray(c.about) && c.about.length ? c.about : DEFAULT.about,
    brand:
      c.brand && typeof c.brand === 'object'
        ? {
            name: String(c.brand.name || DEFAULT.brand.name),
            tag: String(c.brand.tag || DEFAULT.brand.tag),
            logo: String(c.brand.logo || ''),
            avatar: String(c.brand.avatar || '')
          }
        : DEFAULT.brand,
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
      const got = await redisGet();
      if (got.error) {
        return send(res, 200, { ok: true, content: DEFAULT, source: 'default', warn: got.error });
      }
      if (!got.data) {
        return send(res, 200, { ok: true, content: DEFAULT, source: 'empty' });
      }
      return send(res, 200, {
        ok: true,
        content: normalize(got.data),
        source: 'upstash'
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

      const { url, token } = redisEnv();
      if (!url || !token) {
        return send(res, 500, {
          ok: false,
          error: 'UPSTASH_REDIS_REST_URL और UPSTASH_REDIS_REST_TOKEN Vercel env में जोड़ो, फिर Redeploy।'
        });
      }

      const contentObj = normalize({
        posts: body.posts,
        stories: body.stories,
        about: body.about,
        brand: body.brand
      });
      contentObj.updatedAt = new Date().toISOString();

      try {
        await redisSet(contentObj);
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
      }

      const confirm = await redisGet();
      if (confirm.error) {
        return send(res, 500, { ok: false, error: 'Saved but read-back failed: ' + confirm.error });
      }
      const saved = confirm.data ? normalize(confirm.data) : contentObj;

      return send(res, 200, {
        ok: true,
        content: saved,
        source: 'upstash',
        counts: {
          posts: (saved.posts || []).length,
          stories: (saved.stories || []).length
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
