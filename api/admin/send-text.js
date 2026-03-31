// /api/admin/send-text.js — Manually send a custom SMS to a customer (admin only)
import twilio from 'twilio';

function checkAuth(req) {
  return (req.headers.authorization || '').replace('Bearer ', '') === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'Phone and message are required.' });

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to: phone });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
