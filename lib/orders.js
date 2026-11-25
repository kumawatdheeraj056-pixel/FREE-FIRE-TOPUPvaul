import { Redis } from '@upstash/redis';

// Initialize Upstash Redis client using your environment configuration
const redis = new Redis({
  url: process.env.KV_REST_API_URL || 'https://grand-fox-191360.upstash.io',
  token: process.env.KV_REST_API_TOKEN || 'gQAAAAAAAuuAAAIgcDJjYWFiMDE4M2ZmMjA0NDQ3YTM4ODU3ODJkNjA2NTgwOQ',
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

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

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CATALOG = {
  'ff-120': { diamonds: 120, bonus: 0 },
  'ff-300': { diamonds: 300, bonus: 0 },
  'ff-500': { diamonds: 600, bonus: 0 },
  'ff-1000': { diamonds: 1400, bonus: 50 },
};

function orderText(order) {
  const pack = CATALOG[order.packageId];
  const bonus = pack?.bonus ? ` + ${pack.bonus} bonus` : '';

  const status =
    order.status === 'approved'
      ? '✅ <b>APPROVED</b>'
      : '❌ <b>REJECTED</b>';

  return [
    '💎 <b>DiamondVault order</b>',
    `Order: <code>${esc(order.id)}</code>`,
    `Pack: ${pack?.diamonds || ''}${bonus} 💎 — <b>₹${order.amount}</b>`,
    `UID: <code>${esc(order.uid)}</code> (${esc(order.region)})`,
    order.nickname ? `Nick: ${esc(order.nickname)}` : null,
    `Via: ${esc(order.paymentMethod)}`,
    `UTR: <code>${esc(order.utr)}</code>`,
    '',
    status,
  ]
    .filter(Boolean)
    .join('\n');
}

// Order retrieval helper using Vercel KV / Upstash Redis
async function getOrder(orderId) {
  return await redis.get(`order:${orderId}`);
}

// Order update helper using Vercel KV / Upstash Redis
async function updateOrder(orderId, updates) {
  const key = `order:${orderId}`;
  const existing = await redis.get(key);

  if (!existing) return null;

  const updatedOrder = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await redis.set(key, updatedOrder);
  return updatedOrder;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      message: 'Method not allowed',
    });
  }

  const callback = req.body?.callback_query;

  if (!callback) {
    return res.status(200).json({ ok: true });
  }

  const [action, orderId] = String(callback.data || '').split(':');

  if (!orderId || !['ok', 'no'].includes(action)) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Invalid action.',
      show_alert: true,
    });

    return res.status(200).json({ ok: true });
  }

  const existing = await getOrder(orderId);

  if (!existing) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Order not found.',
      show_alert: true,
    });

    return res.status(200).json({ ok: true });
  }

  // Prevent double approval/rejection.
  if (existing.status !== 'pending') {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: `Order already ${existing.status}.`,
      show_alert: true,
    });

    return res.status(200).json({ ok: true });
  }

  const status = action === 'ok' ? 'approved' : 'rejected';

  const order = await updateOrder(orderId, {
    status,
  });

  try {
    await telegram('editMessageText', {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: orderText(order),
      parse_mode: 'HTML',
    });
  } catch (error) {
    console.error('Telegram edit failed:', error.message);
  }

  await telegram('answerCallbackQuery', {
    callback_query_id: callback.id,
    text: status === 'approved' ? 'Approved' : 'Rejected',
  });

  return res.status(200).json({
    ok: true,
    orderId,
    status,
  });
}