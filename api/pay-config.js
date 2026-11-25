export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      message: 'Method not allowed',
    });
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '8717983601:AAGwXm1sEllxXrnMIHcgCwcTCF5c0NzWxeQ';
  const telegramChatId = process.env.TELEGRAM_CHAT_ID || '7354925759,7915314453';
  const upiId = process.env.UPI_ID || '';
  const payeeName = process.env.PAYEE_NAME || 'DiamondVault';

  const chatIds = telegramChatId
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return res.status(200).json({
    ok: true,
    verification: Boolean(telegramBotToken && chatIds.length > 0),
    upiId: upiId || null,
    payeeName,
  });
}