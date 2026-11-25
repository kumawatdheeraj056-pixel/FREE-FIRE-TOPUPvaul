# Setup — Telegram order verification

The code is finished and tested. Only these three values are missing, and only you
can get them. Everything lives in `payment.config.json`.

---

## 1. Create the Telegram bot (2 minutes)

1. Open Telegram on your phone.
2. Search for **@BotFather** and open the chat (it has a blue verified tick).
3. Send `/newbot`.
4. It asks for a **name** — type anything, e.g. `DiamondVault Orders`.
5. It asks for a **username** — must end in `bot`, e.g. `diamondvault_orders_bot`.
   If it says the name is taken, add numbers until it's accepted.
6. BotFather replies with a line like:

   ```
   Use this token to access the HTTP API:
   8123456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

That long string is your **bot token**. Treat it like a password — anyone
holding it can approve your orders.

## 2. Put the token in the config

Open `payment.config.json` and fill it in:

```json
{
  "telegramBotToken": "8123456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "telegramChatId": "",
  "upiId": "yourname@ybl",
  "payeeName": "DiamondVault"
}
```

- **telegramBotToken** — from step 1.
- **telegramChatId** — leave empty. It fills in automatically in step 3.
- **upiId** — your PhonePe/GPay UPI ID, shown on the site so buyers can pay by ID
  as well as by scanning the QR. Optional; leave `""` to show the QR only.
- **payeeName** — the name buyers see. Cosmetic.

## 3. Link your phone to the server

```
npm start
```

Then, in Telegram, open **your new bot** and send `/start`.

The bot replies `✅ Linked!` and the server prints `Telegram chat linked: …`.
Your chat id is now saved in `payment.config.json` — this is a one-time step.

The server log should now say:

```
✓ Telegram verification active.
```

---

## How it runs day to day

1. Buyer picks a pack, scans the QR in the site, pays.
2. Buyer types the **12-digit UTR** from their payment receipt and submits.
3. Your phone buzzes with the order — pack, price, Free Fire UID, region,
   nickname, payment app, UTR, timestamp — plus **✅ Approve** / **❌ Reject**.
4. **Open your own UPI app and confirm the money actually arrived.** The UTR
   proves the buyer saw a receipt; it does not prove you were paid.
5. Tap Approve or Reject. The buyer's page flips automatically within seconds.
6. Deliver the diamonds to the UID shown.

## What protects you

- Prices come from the server's own catalogue — the browser cannot set its price.
- A UTR works exactly once. Reusing one is rejected before it reaches your phone.
- UTR must be exactly 12 digits; UID must be 8–12 digits.
- Max 6 order attempts per IP per 10 minutes.
- Nothing is ever auto-approved. Money only moves after you tap Approve.
- `payment.config.json` and `orders.json` are never served over HTTP.

## What this does NOT do

It cannot read your bank account, so it cannot confirm a payment by itself.
A buyer can still send a real-looking 12-digit number they never paid — step 4
above is the check that catches that, and it stays manual until you add a real
payment gateway or a bank/UPI statement API.

## Orders

Every order is stored in `orders.json` (created on first order) with its status,
UID, UTR and timestamps — useful for disputes and refunds.

## Before going live

- Set your real WhatsApp number in `assets/js/app.js` → `CONFIG.support.whatsapp`
  (currently the placeholder `910000000000`). This is the fallback buyers use if
  the server or Telegram is unreachable.
- Also update `discord` and `email` in the same block.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `⚠ Telegram not configured` | Token missing or empty in `payment.config.json`. |
| `Send /start to your bot to link this chat` | Token is fine; step 3 not done yet. |
| `Telegram poll error: … 401` | Token is wrong — recopy it from BotFather. |
| Site says "submit via WhatsApp instead" | Server reachable but not linked — finish step 3. |
| Buttons do nothing | Someone other than the linked chat tapped them; only your chat may approve. |
