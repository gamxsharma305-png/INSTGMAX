/**
 * POST /api/submit-payment
 * Body: { name, email, mobile, utr, plan, amount, deviceId }
 */
const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8654144417:AAH-RzyTAYavTNRk-cHbVzoxKMX_KKCgOGI';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8276743517';

function redisEnv() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  return { url, token };
}

async function redisSet(key, value, expSeconds) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  const path =
    url +
    '/set/' +
    encodeURIComponent(key) +
    '/' +
    encodeURIComponent(JSON.stringify(value)) +
    (expSeconds ? '?EX=' + expSeconds : '');
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const mobile = String(body.mobile || '').trim();
  const utr = String(body.utr || '').replace(/\s/g, '');
  const plan = String(body.plan || '').trim();
  const amount = String(body.amount || '').trim();
  const deviceId = String(body.deviceId || '').trim();

  if (!name || !email || !mobile || !/^\d{12}$/.test(utr)) {
    return res.status(400).json({ ok: false, error: 'Invalid form data' });
  }

  const id = crypto.randomBytes(6).toString('hex');
  const record = {
    id, name, email, mobile, utr, plan, amount, deviceId,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  try { await redisSet('gmax:pay:' + id, record, 14 * 24 * 60 * 60); } catch (_) {}

  const text =
    'New payment request\n\n' +
    'Name: ' + name + '\n' +
    'Email: ' + email + '\n' +
    'Mobile: ' + mobile + '\n' +
    'UTR: ' + utr + '\n' +
    'Plan: ' + plan + ' (Rs ' + amount + ')\n' +
    'Time: ' + new Date().toLocaleString('en-IN');

  const tg = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Approve', callback_data: 'A:' + id },
          { text: 'Deny', callback_data: 'D:' + id }
        ]]
      }
    })
  });

  const tgJson = await tg.json().catch(() => ({}));
  if (!tgJson.ok) {
    return res.status(200).json({
      ok: false,
      error: 'Telegram failed: ' + (tgJson.description || 'unknown')
    });
  }

  return res.status(200).json({ ok: true, message: 'Submitted', id: id });
};
