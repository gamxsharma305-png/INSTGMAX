/**
 * POST /api/telegram-webhook
 * Set Telegram webhook to: https://instgmax.vercel.app/api/telegram-webhook
 * Approve -> optional Google Sheet via Script 2 GET
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
  try { if (typeof v === 'string') v = JSON.parse(v); } catch (_) {}
  try { if (typeof v === 'string') v = JSON.parse(v); } catch (_) {}
  return typeof v === 'object' && v ? v : null;
}

async function tg(method, payload) {
  await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
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

  const rec = await redisGet('gmax:pay:' + id).catch(() => null);
  const name = (rec && rec.name) || '';
  const email = (rec && rec.email) || '';
  const mobile = (rec && rec.mobile) || '';
  const utr = (rec && rec.utr) || '';
  const plan = (rec && rec.plan) || '';
  const amount = (rec && rec.amount) || '';

  if (action === 'D') {
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Rejected' });
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: 'REJECTED\n\nName: ' + name + '\nUTR: ' + utr + '\nPlan: ' + plan
    });
    return res.status(200).send('OK');
  }

  if (action === 'A') {
    const days = /3|399/.test(String(plan)) ? 90 : /2|299/.test(String(plan)) ? 60 : 30;
    const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN');

    // Save to Google Sheet via Script 2 GET (GET works; Telegram POST webhook on GAS returns 302)
    try {
      const qs = new URLSearchParams({
        action: 'approve',
        name, email, mobile, utr, plan, amount, days: String(days)
      });
      await fetch(SHEET_WEBAPP + '?' + qs.toString(), { redirect: 'follow' });
    } catch (_) {}

    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Saved' });
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text:
        'APPROVED & SAVED\n\n' +
        'Name: ' + name + '\nEmail: ' + email + '\nMobile: ' + mobile +
        '\nUTR: ' + utr + '\nPlan: ' + plan + ' (Rs ' + amount + ')' +
        '\nExpiry: ' + expiry
    });
    return res.status(200).send('OK');
  }

  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Unknown' });
  return res.status(200).send('OK');
};
