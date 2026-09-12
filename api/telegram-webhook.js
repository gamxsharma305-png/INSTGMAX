/**
 * POST /api/telegram-webhook
 * Approve = unlock that user's phone directly (no code sharing).
 */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8654144417:AAH-RzyTAYavTNRk-cHbVzoxKMX_KKCgOGI';
const SHEET_WEBAPP =
  process.env.SHEET_WEBAPP_URL ||
  'https://script.google.com/macros/s/AKfycbznvyS8EYSRIQUwnE6mvExjAIZEKEJwPauczIRvY32T5AcOn_bJTtvWmkXcldUXgnBZ/exec';

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

async function redisSet(key, value, expSeconds) {
  const { url, token } = redisEnv();
  if (!url || !token) return false;
  let path = url + '/set/' + encodeURIComponent(key) + '/' + encodeURIComponent(JSON.stringify(value));
  if (expSeconds) path += '?EX=' + expSeconds;
  const r = await fetch(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  return r.ok;
}

async function tg(method, payload) {
  const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return r.json().catch(() => ({}));
}

function planDays(plan) {
  const p = String(plan || '').toLowerCase();
  if (p.indexOf('3') >= 0 || p.indexOf('399') >= 0) return 90;
  if (p.indexOf('2') >= 0 || p.indexOf('299') >= 0) return 60;
  return 30;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  let update = req.body;
  if (typeof update === 'string') {
    try { update = JSON.parse(update); } catch (_) { update = {}; }
  }
  update = update || {};

  const cq = update.callback_query;
  if (!cq) return res.status(200).send('OK');

  const data = String(cq.data || '');
  const action = data.substring(0, 1);
  const id = data.substring(2);
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const messageId = cq.message && cq.message.message_id;

  let rec = await redisGet('gmax:pay:' + id).catch(() => null) || {};
  const name = rec.name || '';
  const email = rec.email || '';
  const mobile = rec.mobile || '';
  const utr = rec.utr || '';
  const plan = rec.plan || '';
  const amount = rec.amount || '';
  const deviceId = rec.deviceId || '';
  const days = planDays(plan);
  const expSec = days * 24 * 60 * 60 + 86400;

  if (action === 'D') {
    try {
      await redisSet('gmax:pay:' + id, Object.assign({}, rec, { status: 'rejected' }), 14 * 24 * 60 * 60);
    } catch (_) {}
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Rejected' });
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: 'REJECTED\n\nName: ' + name + '\nUTR: ' + utr + '\nPlan: ' + plan
    });
    return res.status(200).send('OK');
  }

  if (action === 'A') {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;

    try {
      await redisSet('gmax:pay:' + id, Object.assign({}, rec, {
        status: 'approved',
        until: until,
        approvedAt: new Date().toISOString()
      }), 14 * 24 * 60 * 60);
    } catch (_) {}

    if (deviceId) {
      try {
        await redisSet('gmax:access:' + deviceId, {
          until: until,
          plan: plan,
          days: days,
          email: email
        }, expSec);
      } catch (_) {}
    }

    try {
      const qs = new URLSearchParams({
        action: 'approve', name, email, mobile, utr, plan, amount, days: String(days)
      });
      await fetch(SHEET_WEBAPP + '?' + qs.toString(), { redirect: 'follow' });
    } catch (_) {}

    const expiry = new Date(until).toLocaleDateString('en-IN');
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'User unlocked' });
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text:
        'APPROVED \u2014 user auto-unlocked\n\n' +
        'Name: ' + name + '\nEmail: ' + email + '\nMobile: ' + mobile +
        '\nUTR: ' + utr + '\nPlan: ' + plan + ' (Rs ' + amount + ')' +
        '\nExpiry: ' + expiry
    });
    return res.status(200).send('OK');
  }

  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Unknown' });
  return res.status(200).send('OK');
};
