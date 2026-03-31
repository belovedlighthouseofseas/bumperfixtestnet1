// /api/admin/update-booking.js — Update booking status + trigger SMS workflows
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

function checkAuth(req) {
  return (req.headers.authorization || '').replace('Bearer ', '') === process.env.ADMIN_PASSWORD;
}

const ALLOWED_STATUSES = [
  'awaiting_review', 'admin_confirmed', 'awaiting_customer_reply',
  'customer_confirmed', 'reschedule_requested', 'canceled', 'completed', 'no_response'
];

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { id, status, notes, sendCustomerSms = true, notifyOwner = true } = req.body || {};

  if (!id || !status) return res.status(400).json({ error: 'Missing id or status.' });
  if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  const updates = { status };
  if (notes !== undefined) updates.notes = notes;
  if (status === 'admin_confirmed') {
    updates.admin_confirmed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const FROM   = process.env.TWILIO_PHONE_NUMBER;
  const OWNER  = process.env.OWNER_PHONE;

  // ── Admin confirmed → send customer confirmation SMS ──────────────────────
  if (status === 'admin_confirmed' && sendCustomerSms && data.phone) {
    const confirmMsg =
      `Bumper Fix: Your appointment is confirmed for ${data.date} at ${data.time}.\n\n` +
      `Name: ${data.name}\nLocation: ${data.area}\n\n` +
      `Please reply CONFIRMED to lock it in on your side.\n` +
      `If you need to reschedule, reply RESCHEDULE.\n\n` +
      `If you have not already done so, reply with a photo of the damage and your vehicle year/make/model.\n\n` +
      `- Bumper Fix\n(858) 988-0325`;
    try {
      await client.messages.create({ body: confirmMsg, from: FROM, to: data.phone });
      await supabase.from('bookings').update({ confirmation_sms_sent_at: new Date().toISOString() }).eq('id', id);
    } catch (e) { console.error('[update-booking] Customer confirm SMS error:', e.message); }

    // Owner alert
    if (notifyOwner && OWNER) {
      try {
        await client.messages.create({
          body: `BOOKING CONFIRMED\n\n${data.name}\n${data.phone}\n${data.date} at ${data.time}\n${data.area}\n\nStatus: Confirmed`,
          from: FROM, to: OWNER
        });
      } catch (e) { console.error('[update-booking] Owner notify error:', e.message); }
    }
  }

  // ── Canceled → text customer ──────────────────────────────────────────────
  if (status === 'canceled' && data.phone) {
    try {
      await client.messages.create({
        body: `Bumper Fix: Your appointment on ${data.date} at ${data.time} has been canceled. Call/text (858) 988-0325 to reschedule.`,
        from: FROM, to: data.phone
      });
    } catch (e) { console.error('[update-booking] Cancel SMS error:', e.message); }
    if (OWNER) {
      try {
        await client.messages.create({
          body: `BOOKING CANCELED\n\n${data.name}\n${data.phone}\n${data.date} at ${data.time}\n${data.area}`,
          from: FROM, to: OWNER
        });
      } catch (e) {}
    }
  }

  return res.status(200).json({ success: true, booking: data });
}
