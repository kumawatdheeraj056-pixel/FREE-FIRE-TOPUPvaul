import { healthSnapshot } from '../lib/player-verification.mjs';

export default function handler(req, res) {
  const expected = process.env.PLAYER_INFO_ADMIN_TOKEN || '';
  if (req.method !== 'GET' || !expected || req.headers['x-admin-token'] !== expected) {
    return res.status(404).json({ ok: false, message: 'Not found.' });
  }
  return res.status(200).json({ ok: true, providers: healthSnapshot() });
}
