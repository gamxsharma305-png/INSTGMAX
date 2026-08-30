const crypto = require('crypto');

function htmlPage(code, ok, msg) {
  const body = ok
    ? `<div class="code">${code}</div>
       <p class="hint">Copy this 12-digit code and open the main site → Verify.<br/>Access stays valid for 36 hours.</p>
       <button onclick="navigator.clipboard.writeText('${code}')">Copy Code</button>`
    : `<p class="err">${msg || 'Invalid or expired link'}</p>`;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Access Code</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#12081C;color:#f5f0ff;font-family:system-ui,sans-serif;padding:20px}
  .card{background:rgba(40,20,60,.85);border:1px solid rgba(196,161,255,.35);border-radius:20px;
    padding:28px;max-width:360px;width:100%;text-align:center;backdrop-filter:blur(16px)}
  .code{font-size:28px;letter-spacing:.18em;font-weight:800;color:#C4A1FF;margin:16px 0;font-family:ui-monospace,monospace}
  .hint{color:#b9a8d4;font-size:13px;line-height:1.55}
  .err{color:#f87171}
  button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:12px;background:#C4A1FF;color:#12081C;font-weight:700;cursor:pointer}
</style></head><body><div class="card"><h2>Lumina Key</h2>${body}</div></body></html>`;
}

module.exports = async function handler(req, res) {
  const secret = process.env.KEY_SECRET || process.env.AROLINKS_TOKEN || 'change-me';
  const q = req.query || {};
  const code = String(q.c || '');
  const exp = parseInt(q.e || '0', 10);
  const sig = String(q.s || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!/^\d{12}$/.test(code) || !exp || !sig) return res.status(400).send(htmlPage('', false, 'Link incomplete.'));
  if (Date.now() > exp) return res.status(400).send(htmlPage('', false, 'Link expired. Tap Get Key again.'));
  const expect = crypto.createHmac('sha256', secret).update(`${code}.${exp}`).digest('hex').slice(0, 24);
  if (expect !== sig) return res.status(400).send(htmlPage('', false, 'Invalid signature.'));
  return res.status(200).send(htmlPage(code, true));
};
