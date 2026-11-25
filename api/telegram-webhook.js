import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8717983601:AAGwXm1sEllxXrnMIHcgCwcTCF5c0NzWxeQ';
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

function parseOrderFromMessage(text, id) {
  if (!text) return null;
  const uidMatch = text.match(/UID:\s*([^\s\n(]+)/);
  const utrMatch = text.match(/UTR:\s*([^\s\n]+)/);
  const amountMatch = text.match(/₹(\d+)/);
  return {
    id,
    status: 'pending',
    packageId: 'ff-520',
    amount: amountMatch ? Number(amountMatch[1]) : 198,
    uid: uidMatch ? uidMatch[1] : 'Unknown',
    region: 'India',
    paymentMethod: 'UPI',
    utr: utrMatch ? utrMatch[1] : 'Unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function telegram(method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      message: 'Method not allowed',
    });
  }

  loadOrders();

  const update = req.body;
  const callback = update?.callback_query;

  if (!callback) {
    return res.status(200).json({ ok: true });
  }

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
    });
    return res.status(200).json({ ok: true });
  }

  if (order.status === 'approved' || order.status === 'rejected') {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: `Order already ${order.status}!`,
      show_alert: true,
    });
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

  const catalog = {
    'ff-100': { diamonds: 100, bonus: 0 },
    'ff-310': { diamonds: 310, bonus: 0 },
    'ff-520': { diamonds: 520, bonus: 0 },
    'ff-1060': { diamonds: 1060, bonus: 0 },
  };

  const pack = catalog[order.packageId];
  const bonus = pack?.bonus ? ` + ${pack.bonus} bonus` : '';

  const text = [
    '🔔 <b>New top-up order</b>',
    `Order: <code>${order.id}</code>`,
    `Pack: ${pack?.diamonds || ''}${bonus} 💎 — <b>₹${order.amount}</b>`,
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
  });

  return res.status(200).json({ ok: true });
}
