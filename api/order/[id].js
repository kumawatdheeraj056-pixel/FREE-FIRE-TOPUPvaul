import { readFileSync, existsSync } from 'node:fs';

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

function loadOrders() {
  if (existsSync(TMP_ORDERS)) {
    try {
      const saved = JSON.parse(readFileSync(TMP_ORDERS, 'utf8'));
      Object.assign(orders, saved);
    } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      message: 'Method not allowed',
    });
  }

  loadOrders();

  const id = req.query?.id;

  if (!id) {
    return res.status(400).json({
      ok: false,
      message: 'Missing order ID.',
    });
  }

  let order = orders[id];
  if (!order) {
    order = await kvGet(`order:${id}`);
    if (order) orders[id] = order;
  }

  if (!order) {
    return res.status(404).json({
      ok: false,
      message: 'Order not found.',
    });
  }

  return res.status(200).json({
    ok: true,
    orderId: order.id,
    status: order.status,
  });
}