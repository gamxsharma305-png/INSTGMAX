/**
 * Shared content for all users.
 * Stores JSON in GitHub content.json via Contents API.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPO (owner/name), GITHUB_BRANCH (optional), ADMIN_PIN
 */
const crypto = require('crypto');

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

function repoParts() {
  const repo = String(process.env.GITHUB_REPO || '').trim();
  const parts = repo.split('/').filter(Boolean);
  return {
    owner: parts[0] || '',
    name: parts[1] || '',
    branch: String(process.env.GITHUB_BRANCH || 'main').trim() || 'main'
  };
}

function b64encode(str) {
  return Buffer.from(String(str), 'utf8').toString('base64');
}

function b64decode(str) {
  return Buffer.from(String(str), 'base64').toString('utf8');
}

async function githubGetFile() {
  const token = process.env.GITHUB_TOKEN;
  const { owner, name, branch } = repoParts();
  if (!token || !owner || !name) return { missing: true, reason: 'no_env' };

  const url =
    'https://api.github.com/repos/' +
    owner +
    '/' +
    name +
    '/contents/content.json?ref=' +
    encodeURIComponent(branch);

  const r = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lumina-gmax-content'
    }
  });

  if (r.status === 404) return { missing: true, reason: 'file_404' };
  if (!r.ok) {
    const t = await r.text();
    return { error: 'GitHub read ' + r.status + ': ' + t.slice(0, 180) };
  }
  const data = await r.json();
  let parsed = { ...DEFAULT };
  try {
    parsed = JSON.parse(b64decode(data.content || ''));
  } catch (_) {}
  return { sha: data.sha, data: parsed };
}

async function githubPutFile(contentObj, sha) {
  const token = process.env.GITHUB_TOKEN;
  const { owner, name, branch } = repoParts();
  if (!token || !owner || !name) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO missing in Vercel Environment Variables');
  }

  const body = {
    message: 'Lumina content update',
    content: b64encode(JSON.stringify(contentObj, null, 2)),
    branch
  };
  if (sha) body.sha = sha;

  const url = 'https://api.github.com/repos/' + owner + '/' + name + '/contents/content.json';
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lumina-gmax-content',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error('GitHub write ' + r.status + ': ' + t.slice(0, 250));
  }
  return r.json();
}

function normalizeContent(c) {
  c = c || {};
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
      try {
        const file = await githubGetFile();
        if (file.error) {
          return send(res, 200, { ok: true, content: DEFAULT, source: 'default', warn: file.error });
        }
        if (file.missing) {
          return send(res, 200, { ok: true, content: DEFAULT, source: 'default' });
        }
        return send(res, 200, {
          ok: true,
          content: normalizeContent(file.data),
          source: 'github'
        });
      } catch (e) {
        return send(res, 200, {
          ok: true,
          content: DEFAULT,
          source: 'default',
          warn: String(e && e.message ? e.message : e)
        });
      }
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

      if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
        return send(res, 500, {
          ok: false,
          error:
            'GITHUB_TOKEN या GITHUB_REPO Vercel env में नहीं है। Settings → Environment Variables में दोनों जोड़ो।'
        });
      }

      const contentObj = normalizeContent({
        posts: body.posts,
        stories: body.stories,
        about: body.about,
        brand: body.brand,
        updatedAt: new Date().toISOString()
      });
      contentObj.updatedAt = new Date().toISOString();

      let sha = null;
      const existing = await githubGetFile();
      if (existing && existing.sha) sha = existing.sha;
      if (existing && existing.error) {
        return send(res, 500, { ok: false, error: existing.error });
      }

      try {
        await githubPutFile(contentObj, sha);
      } catch (e) {
        return send(res, 500, {
          ok: false,
          error: String(e && e.message ? e.message : e)
        });
      }

      return send(res, 200, { ok: true, content: contentObj });
    }

    return send(res, 405, { error: 'GET or POST only' });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'Server: ' + String(e && e.message ? e.message : e) });
  }
};

