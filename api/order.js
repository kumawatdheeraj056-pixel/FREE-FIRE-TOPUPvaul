import { readFileSync, writeFileSync, existsSync } from 'fs';

const CATALOG = {
  'ff-100': { label: '100 Diamonds', diamonds: 100, bonus: 0, price: 38 },
  'ff-310': { label: '310 Diamonds', diamonds: 310, bonus: 0, price: 118 },
  'ff-520': { label: '520 Diamonds', diamonds: 520, bonus: 0, price: 198 },
  'ff-1060': { label: '1060 Diamonds', diamonds: 1060, bonus: 0, price: 404 },
};

const PAY_METHODS = new Set(['UPI', 'PhonePe', 'Google Pay', 'Paytm']);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8717983601:AAGwXm1sEllxXrnMIHcgCwcTCF5c0NzWxeQ';
const CHAT_IDS = String(process.env.TELEGRAM_CHAT_ID || '7354925759,7915314453')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const TMP_ORDERS = '/tmp/orders.json';
const orders = globalThis.__diamondVaultOrders || {};
globalThis.__diamondVaultOrders = orders;

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (data.result) {
      return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    }
  } catch (err) {
    console.error('KV get error:', err.message);
  }
  return null;
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });
  } catch (err) {
    console.error('KV set error:', err.message);
  }
}

function loadOrders() {
  if (existsSync(TMP_ORDERS)) {
    try {
      const saved = JSON.parse(readFileSync(TMP_ORDERS, 'utf8'));
      Object.assign(orders, saved);
    } catch {}
  }
}

function saveOrders() {
  try {
    writeFileSync(TMP_ORDERS, JSON.stringify(orders, null, 2));
  } catch {}
}

function newOrderId() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `FF-${stamp}-${rand}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function orderText(order) {
  const pack = CATALOG[order.packageId];
  const bonus = pack?.bonus ? ` + ${pack.bonus} bonus` : '';

  return [
    '💎 <b>New DiamondVault order</b>',
    `Order: <code>${esc(order.id)}</code>`,
    `Pack: ${esc(pack?.diamonds ?? '')}${bonus} 💎 — <b>₹${order.amount}</b>`,
    `UID: <code>${esc(order.uid)}</code> (${esc(order.region)})`,
    order.nickname ? `Nick: ${esc(order.nickname)}` : null,
    `Via: ${esc(order.paymentMethod)}`,
    `UTR: <code>${esc(order.utr)}</code>`,
    `Consent: Terms Agreed ✅`,
    `Time: ${new Date(order.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
    })} IST`,
  ]
    .filter(Boolean)
    .join('\n');
}

function parseOrderFromMessage(text, id) {
  if (!text) return null;
  const uidMatch = text.match(/UID:\s*([^\s\n(]+)/);
  const utrMatch = text.match(/UTR:\s*([^\s\n]+)/);
  const amountMatch = text.match(/₹(\d+)/);
  return {
    id,
    status: 'pending',
    packageId: 'ff-520',
    amount: amountMatch ? Number(amountMatch[1]) : 399,
    uid: uidMatch ? uidMatch[1] : 'Unknown',
    region: 'India',
    paymentMethod: 'UPI',
    utr: utrMatch ? utrMatch[1] : 'Unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function telegram(method, payload) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram request failed (${response.status})`);
  return data.result || data;
}

export default async function handler(req, res) {
  try {
    loadOrders();

  // 1. SETUP WEBHOOK
  if (req.method === 'GET' && req.query?.setup === 'webhook') {
    const host = req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/api/order?webhook=1`;
    try {
      const data = await telegram('setWebhook', { url });
      return res.status(200).json({ ok: true, message: 'Webhook updated successfully', url, telegramResponse: data });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }
  }

  // 2. GET ORDER (POLLING)
  if (req.method === 'GET' && req.query?.id) {
    const id = req.query.id;
    let order = orders[id];
    if (!order) {
      order = await kvGet(`order:${id}`);
      if (order) orders[id] = order;
    }

    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }

    return res.status(200).json({
      ok: true,
      orderId: order.id,
      status: order.status,
    });
  }

  // 3. TELEGRAM WEBHOOK
  if (req.method === 'POST' && req.query?.webhook === '1') {
    const update = req.body;
    const callback = update?.callback_query;

    if (!callback) return res.status(200).json({ ok: true });

    const [action, orderId] = String(callback.data || '').split(':');
    let order = orders[orderId];

    if (!order) {
      order = await kvGet(`order:${orderId}`);
    }

    if (!order) {
      order = parseOrderFromMessage(callback.message?.text || callback.message?.caption, orderId);
    }

    if (!order) {
      await telegram('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Order details not found.',
        show_alert: true,
      }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (order.status === 'approved' || order.status === 'rejected') {
      await telegram('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: `Order already ${order.status}!`,
        show_alert: true,
      }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    order.status = action === 'ok' ? 'approved' : 'rejected';
    order.updatedAt = new Date().toISOString();
    orders[orderId] = order;

    await kvSet(`order:${orderId}`, order);
    saveOrders();

    const statusLine =
      order.status === 'approved'
        ? '✅ <b>APPROVED</b> — buyer notified, deliver diamonds now.'
        : '❌ <b>REJECTED</b> — buyer notified.';

    const pack = CATALOG[order.packageId] || { diamonds: 520, bonus: 0 };
    const bonus = pack.bonus ? ` + ${pack.bonus} bonus` : '';

    const text = [
      '🔔 <b>New top-up order</b>',
      `Order: <code>${order.id}</code>`,
      `Pack: ${pack.diamonds}${bonus} 💎 — <b>₹${order.amount}</b>`,
      `UID: <code>${order.uid}</code> (${order.region})`,
      order.nickname ? `Nick: ${order.nickname}` : null,
      `Via: ${order.paymentMethod}`,
      `UTR: <code>${order.utr}</code>`,
      `Consent: Terms Agreed ✅`,
      '',
      statusLine,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await telegram('editMessageText', {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text,
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('Telegram edit failed:', error.message);
    }

    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: order.status === 'approved' ? 'Approved ✅' : 'Rejected ❌',
    }).catch(() => {});

    return res.status(200).json({ ok: true });
  }

  // 4. CREATE NEW ORDER
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }

    if (!body) return res.status(400).json({ ok: false, message: 'Invalid request body.' });

    const packageId = String(body.packageId || '');
    const uid = String(body.uid || '');
    const region = String(body.region || '').slice(0, 32);
    const nickname = String(body.nickname || '').slice(0, 40);
    const paymentMethod = String(body.paymentMethod || 'UPI');
    const utr = String(body.utr || '');

    const pack = CATALOG[packageId];
    if (!pack) return res.status(400).json({ ok: false, message: 'Unknown package.' });
    if (!/^\d{8,12}$/.test(uid)) return res.status(400).json({ ok: false, message: 'Invalid Free Fire UID.' });
    if (!PAY_METHODS.has(paymentMethod)) return res.status(400).json({ ok: false, message: 'Invalid payment method.' });
    if (!/^\d{12}$/.test(utr)) return res.status(400).json({ ok: false, field: 'utr', message: 'The UTR must be 12 digits.' });

    if (!BOT_TOKEN || !CHAT_IDS.length) {
      return res.status(503).json({ ok: false, message: 'Payment verification service is temporarily unavailable.' });
    }

    const order = {
      id: newOrderId(),
      status: 'pending',
      packageId,
      amount: pack.price,
      uid,
      region,
      nickname,
      paymentMethod,
      utr,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      telegramMessages: {},
    };

    let telegramSent = false;
    for (const chatId of CHAT_IDS) {
      try {
        const message = await telegram('sendMessage', {
          chat_id: chatId,
          text: orderText(order),
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `ok:${order.id}` },
                { text: '❌ Reject', callback_data: `no:${order.id}` },
              ],
            ],
          },
        });
        order.telegramMessages[chatId] = message.message_id;
        telegramSent = true;
      } catch (error) {
        console.error(`Telegram failed for ${chatId}:`, error.message);
      }
    }

    if (!telegramSent) return res.status(502).json({ ok: false, message: 'Could not contact Telegram.' });

    orders[order.id] = order;
    await kvSet(`order:${order.id}`, order);
    saveOrders();

    return res.status(201).json({ ok: true, orderId: order.id, status: order.status });
  }

  return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (error) {
    console.error('Unhandled API Error:', error);
    return res.status(500).json({ 
      ok: false, 
      message: 'Internal Server Error', 
      error: String(error.message || error),
      stack: String(error.stack || '')
    });
  }
}
