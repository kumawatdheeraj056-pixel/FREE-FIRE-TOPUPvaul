import { verifyPlayer } from '../lib/player-verification.mjs';

const clients = new Map();
function allowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const entry = clients.get(ip) || { started: now, count: 0 };
  if (now - entry.started >= 60_000) { entry.started = now; entry.count = 0; }
  entry.count++;
  clients.set(ip, entry);
  return entry.count <= 30;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ status: 'UNKNOWN', message: 'Method not allowed.' });
  if (!allowed(req)) return res.status(429).json({ status: 'UNKNOWN', message: 'Please retry shortly.' });
  try {
    const result = await verifyPlayer({ uid: req.query?.uid, region: req.query?.region || 'ind' });
    const { status, uid, nickname, region, level, provider, cached, message } = result;
    return res.status(200).json({ status, uid, nickname, username: nickname, region, level, provider, cached, message });
  } catch {
    return res.status(200).json({ status: 'UNKNOWN', message: 'Player verification temporarily unavailable. Please retry.' });
  }
}
