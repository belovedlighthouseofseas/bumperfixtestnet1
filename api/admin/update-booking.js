// /api/admin/update-booking.js — Update booking status (admin only)
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

function checkAuth(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  return token === process.env.ADMIN_PASSWORD;
}

const ALLOWED_STATUSES = ['confirmed', 'yes_confirmed', 'reschedule_requested', 'canceled', 'completed', 'no_response'];

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { id, status, notes } = req.body || {};

  if (!id || !status) return res.status(400).json({ error: 'Missing id or status.' });
  if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  const updates = { status };
  if (notes !== undefined) updates.notes = notes;

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // If admin cancels, text the customer
  if (status === 'canceled' && data.phone) {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `Bumper Fix: Your appointment on ${data.date} at ${data.time} has been canceled. Call/text (858) 988-0325 to reschedule.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: data.phone
      });
    } catch (e) {
      console.error('[update-booking] SMS error:', e.message);
    }
  }

  return res.status(200).json({ success: true, booking: data });
}
