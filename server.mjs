/**
 * DiamondVault server — static site + gateway-free UPI payment verification.
 *
 *   node server.mjs        → http://localhost:4173
 *   node server.mjs 8080   → http://localhost:8080
 *
 * ── How payment verification works (no Stripe/Razorpay) ─────────────────────
 * 1. The buyer scans your UPI QR, pays, and submits the 12-digit UTR from
 *    their payment app. The site POSTs the order to /api/order.
 * 2. This server validates it (server-side pricing, UTR de-duplication,
 *    rate limiting) and pushes it to YOUR Telegram with ✅ Approve / ❌ Reject
 *    buttons.
 * 3. You check the money actually landed in your UPI app, tap a button, and
 *    the buyer's browser (which polls /api/order/:id) flips to
 *    confirmed / rejected automatically.
 *
 * ── One-time setup ──────────────────────────────────────────────────────────
 * 1. In Telegram, message @BotFather → /newbot → copy the bot token.
 * 2. Put the token in payment.config.json (created on first run) or set the
 *    TELEGRAM_BOT_TOKEN environment variable.
 * 3. Start this server, then send /start to your bot in Telegram once —
 *    the chat id is captured and saved automatically.
 * Orders live in orders.json next to this file.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPlayer, healthSnapshot } from './lib/player-verification.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

/* ==========================================================================
   Config
   ========================================================================== */
const CONFIG_PATH = join(ROOT, 'payment.config.json');
const ORDERS_PATH = join(ROOT, 'orders.json');

const DEFAULT_CONFIG = {
  telegramBotToken: '',
  telegramChatId: '',
  upiId: '',
  payeeName: 'DiamondVault',
};

function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_PATH)) {
    try {
      cfg = { ...cfg, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
    } catch (err) {
      console.error('! payment.config.json is not valid JSON — using defaults.', err.message);
    }
  } else {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log('Created payment.config.json — add your Telegram bot token there.');
  }
  if (process.env.TELEGRAM_BOT_TOKEN) cfg.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) cfg.telegramChatId = process.env.TELEGRAM_CHAT_ID;
  return cfg;
}

const config = loadConfig();
// Public UPI receiver used by the checkout and dynamically generated QR codes.
config.upiId = process.env.UPI_ID || 'topupvault@naviaxis';
config.payeeName = process.env.UPI_PAYEE_NAME || 'TopUpVault';

function saveConfig() {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/* ==========================================================================
   Server-side catalogue — the client never sets its own price.
   ========================================================================== */
const CATALOG = {
  'ff-100': { label: '100 Diamonds', diamonds: 100, bonus: 0, price: 38 },
  'ff-310': { label: '310 Diamonds', diamonds: 310, bonus: 0, price: 118 },
  'ff-520': { label: '520 Diamonds', diamonds: 520, bonus: 0, price: 198 },
  'ff-1060': { label: '1060 Diamonds', diamonds: 1060, bonus: 0, price: 404 },
};
const PAY_METHODS = new Set(['UPI', 'PhonePe', 'Google Pay', 'Paytm']);
const playerClients = new Map();

function playerRateAllowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const item = playerClients.get(ip) || { started: now, count: 0 };
  if (now - item.started >= 60_000) { item.started = now; item.count = 0; }
  item.count++;
  playerClients.set(ip, item);
  return item.count <= 30;
}

/* ==========================================================================
   Orders — persisted to orders.json, UTRs are single-use.
   ========================================================================== */
let orders = {};

function loadOrders() {
  if (existsSync(ORDERS_PATH)) {
    try {
      const diskOrders = JSON.parse(readFileSync(ORDERS_PATH, 'utf8'));
      orders = { ...orders, ...diskOrders };
    } catch {}
  }
  return orders;
}
loadOrders();

function saveOrders() {
  loadOrders();
  writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

function newOrderId() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `FF-${stamp}-${rand}`;
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
    amount: amountMatch ? Number(amountMatch[1]) : 0,
    uid: uidMatch ? uidMatch[1] : 'Unknown',
    region: 'India',
    paymentMethod: 'UPI',
    utr: utrMatch ? utrMatch[1] : 'Unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function utrInUse(utr) {
  return Object.values(orders).some((o) => o.utr === utr && o.status !== 'rejected');
}

/* ==========================================================================
   Tiny per-IP rate limit: max 6 order attempts per 10 minutes.
   ========================================================================== */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 10 * 60 * 1000;
  const list = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  list.push(now);
  hits.set(ip, list);
  return list.length > 6;
}

/* ==========================================================================
   Telegram
   ========================================================================== */
const tgConfigured = () => Boolean(config.telegramBotToken);
const getChatIds = () =>
  config.telegramChatId
    ? String(config.telegramChatId)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const tgReady = () => Boolean(config.telegramBotToken && getChatIds().length > 0);
const isAuthorizedChat = (chatId) => getChatIds().includes(String(chatId));

async function tg(method, payload, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function orderText(o, statusLine = '') {
  const pack = CATALOG[o.packageId];
  const bonus = pack ? (pack.bonus ? ` + ${pack.bonus} bonus` : '') : '';
  const diamonds = pack ? pack.diamonds : o.packageId;
  const price = pack ? pack.amount ?? pack.price : o.amount;
  const ipStr = o.ip ? `\nIP: <code>${esc(o.ip)}</code>` : '';
  return (
    `🔔 <b>New top-up order</b>\n` +
    `Order: <code>${o.id}</code>\n` +
    `Pack: ${diamonds}${bonus} 💎 — <b>₹${price}</b>\n` +
    `UID: <code>${esc(o.uid)}</code> (${esc(o.region)})` +
    (o.nickname ? `\nNick: ${esc(o.nickname)}` : '') +
    `\nVia: ${esc(o.paymentMethod)}\n` +
    `UTR: <code>${esc(o.utr)}</code>` +
    ipStr +
    `\nConsent: Terms Agreed ✅\n` +
    `⏱ ${new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` +
    (statusLine ? `\n\n${statusLine}` : '')
  );
}

async function notifyOrder(order) {
  const chatIds = getChatIds();
  if (chatIds.length === 0) throw new Error('No Telegram chat IDs configured.');
  order.tgMessages = order.tgMessages ?? {};
  let sentAny = false;
  for (const chatId of chatIds) {
    try {
      const msg = await tg('sendMessage', {
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
      order.tgMessages[chatId] = msg.message_id;
      sentAny = true;
    } catch (err) {
      console.error(`Telegram notify failed for chat ${chatId}:`, err.message);
    }
  }
  if (!sentAny) throw new Error('Failed to send notification to configured Telegram chats.');
}

/** Long-poll loop: captures the owner chat id on first contact and handles
 *  the Approve / Reject taps. Restarts itself on network errors. */
let tgOffset = 0;

async function pollTelegram() {
  if (!tgConfigured()) return;
  for (;;) {
    try {
      const updates = await tg(
        'getUpdates',
        {
          offset: tgOffset,
          timeout: 10,
          allowed_updates: ['message', 'callback_query'],
        },
        20000,
      );

      for (const u of updates) {
        tgOffset = u.update_id + 1;

        // Any admin messaging the bot is automatically linked.
        if (u.message) {
          const chatId = String(u.message.chat.id);
          const currentIds = getChatIds();
          if (!currentIds.includes(chatId)) {
            const updated = [...currentIds, chatId];
            config.telegramChatId = updated.join(', ');
            saveConfig();
            await tg('sendMessage', {
              chat_id: chatId,
              text: '✅ Linked! You will now receive order verification requests for DiamondVault.',
            });
            console.log(`Telegram chat linked: ${chatId}`);
          } else {
            await tg('sendMessage', {
              chat_id: chatId,
              text: 'ℹ️ This chat already receives order alerts. Waiting for orders…',
            });
          }
          continue;
        }

        if (u.callback_query) {
          const cq = u.callback_query;
          const chatId = String(cq.message?.chat?.id);
          if (!isAuthorizedChat(chatId)) {
            await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Not authorised.' });
            continue;
          }
          const [verb, id] = String(cq.data).split(':');
          let order = orders[id];
          if (!order) {
            order = parseOrderFromMessage(cq.message?.text || cq.message?.caption, id);
            if (order) {
              orders[id] = order;
            }
          }
          if (!order) {
            await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Order details not found.' });
            continue;
          }
          if (order.status === 'approved' || order.status === 'rejected') {
            await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Already ${order.status} ✅` });
            continue;
          }

          order.status = verb === 'ok' ? 'approved' : 'rejected';
          order.updatedAt = new Date().toISOString();
          orders[id] = order;
          saveOrders();

          const line =
            order.status === 'approved'
              ? '✅ <b>APPROVED</b> — buyer notified, deliver the diamonds now.'
              : '❌ <b>REJECTED</b> — buyer notified.';

          for (const cId of getChatIds()) {
            const msgId = order.tgMessages?.[cId] ?? (cId === chatId ? cq.message.message_id : null);
            if (msgId) {
              try {
                await tg('editMessageText', {
                  chat_id: cId,
                  message_id: msgId,
                  text: orderText(order, line),
                  parse_mode: 'HTML',
                });
              } catch {}
            }
          }

          await tg('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: order.status === 'approved' ? 'Approved ✅' : 'Rejected ❌',
          });
          console.log(`Order ${id} ${order.status}`);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError' && !err.message?.includes('fetch failed')) {
        console.error('Telegram poll update:', err.message);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/* ==========================================================================
   API
   ========================================================================== */
function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/player-info') {
    if (!playerRateAllowed(req)) return json(res, 429, { status: 'UNKNOWN', message: 'Please retry shortly.' });
    const params = new URL(req.url, 'http://localhost').searchParams;
    const result = await verifyPlayer({ uid: params.get('uid'), region: params.get('region') || 'ind' });
    return json(res, 200, { ...result, username: result.nickname });
  }

  if (req.method === 'GET' && pathname === '/api/player-health') {
    const expected = process.env.PLAYER_INFO_ADMIN_TOKEN || '';
    if (!expected || req.headers['x-admin-token'] !== expected) return json(res, 404, { ok: false, message: 'Not found.' });
    return json(res, 200, { ok: true, providers: healthSnapshot() });
  }
  // Client feature probe: is auto-verification available, and what UPI id to show?
  if (req.method === 'GET' && pathname === '/api/pay-config') {
    return json(res, 200, {
      ok: true,
      verification: tgReady(),
      upiId: config.upiId || null,
      payeeName: config.payeeName || null,
    });
  }

  if (req.method === 'POST' && pathname === '/api/order') {
    if (!tgReady()) {
      return json(res, 503, {
        ok: false,
        message: 'Automatic verification is not set up yet. Please submit via WhatsApp instead.',
      });
    }
    const ip = req.socket.remoteAddress ?? '?';
    if (rateLimited(ip)) {
      return json(res, 429, { ok: false, message: 'Too many attempts — wait a few minutes and try again.' });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { ok: false, message: 'Invalid request.' });
    }

    const pack = CATALOG[body.packageId];
    const uid = String(body.uid ?? '');
    const utr = String(body.utr ?? '');
    const region = String(body.region ?? '').slice(0, 32);
    const nickname = String(body.nickname ?? '').slice(0, 40);
    const paymentMethod = String(body.paymentMethod ?? '');

    if (!pack) return json(res, 400, { ok: false, message: 'Unknown package.' });
    if (!/^\d{8,12}$/.test(uid)) return json(res, 400, { ok: false, message: 'Invalid Free Fire UID.' });
    if (!PAY_METHODS.has(paymentMethod)) return json(res, 400, { ok: false, message: 'Invalid payment method.' });
    if (!/^\d{12}$/.test(utr)) {
      return json(res, 400, { ok: false, field: 'utr', message: 'The UTR is the 12-digit number on your payment receipt.' });
    }
    if (utrInUse(utr)) {
      return json(res, 409, { ok: false, field: 'utr', message: 'This UTR has already been used for another order.' });
    }

    const clientIp = String(req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'Unknown');
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 150);

    const order = {
      id: newOrderId(),
      status: 'pending',
      packageId: body.packageId,
      amount: pack.price,
      uid,
      region,
      nickname,
      paymentMethod,
      utr,
      ip: clientIp,
      userAgent,
      termsAgreed: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await notifyOrder(order);
    } catch (err) {
      console.error('Telegram notify failed:', err.message);
      return json(res, 502, {
        ok: false,
        message: 'Could not reach the verification service. Please submit via WhatsApp instead.',
      });
    }

    orders[order.id] = order;
    saveOrders();
    console.log(`Order ${order.id}: ₹${order.amount} UID ${order.uid} UTR ${order.utr}`);
    return json(res, 201, { ok: true, orderId: order.id, status: order.status });
  }

  const statusMatch = pathname.match(/^\/api\/order\/(FF-[A-Z0-9]+-[A-Z0-9]+)$/);
  if (req.method === 'GET' && statusMatch) {
    loadOrders();
    const order = orders[statusMatch[1]];
    if (!order) return json(res, 404, { ok: false, message: 'Order not found.' });
    return json(res, 200, { ok: true, orderId: order.id, status: order.status });
  }

  return json(res, 404, { ok: false, message: 'Not found.' });
}

/* ==========================================================================
   Static files (unchanged) + API mount
   ========================================================================== */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    /* malformed URL — fall through to 404 */
  }

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      console.error('API error:', err);
      if (!res.headersSent) json(res, 500, { ok: false, message: 'Server error.' });
    }
    return;
  }

  // Never serve the config or order book, even though they sit in ROOT.
  if (/payment\.config\.json$|orders\.json$/.test(pathname)) {
    res.writeHead(404);
    res.end();
    return;
  }

  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const candidates = safe.endsWith('/')
    ? [join(safe, 'index.html')]
    : extname(safe)
      ? [safe]
      : [safe + '.html', join(safe, 'index.html')];

  for (const candidate of candidates) {
    const file = join(ROOT, candidate);
    if (!file.startsWith(ROOT)) break;
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(file));
      return;
    } catch {
      /* try the next candidate */
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>404</title><p>Not found. <a href="/">Go home</a>.');
}).listen(PORT, () => {
  console.log(`DiamondVault → http://localhost:${PORT}`);
  if (!tgConfigured()) {
    console.log('⚠ Telegram not configured — orders will fall back to WhatsApp submission.');
    console.log('  Add your bot token to payment.config.json (see file header for setup).');
  } else if (!config.telegramChatId) {
    console.log('→ Bot token found. Send /start to your bot in Telegram to link this chat.');
  } else {
    console.log('✓ Telegram verification active.');
  }
  pollTelegram();
});
