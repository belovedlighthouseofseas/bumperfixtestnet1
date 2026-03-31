// /api/incoming-sms.js — Twilio inbound SMS webhook
// Handles CONFIRMED / YES / RESCHEDULE / NO / STOP replies
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

function twiml(msg) {
  return msg ? `<Response><Message>${msg}</Message></Response>` : '<Response></Response>';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed.');

  const body  = req.body || {};
  const from  = body.From || '';
  const text  = (body.Body || '').trim().toUpperCase();

  res.setHeader('Content-Type', 'text/xml');
  if (!from) return res.status(200).send('<Response></Response>');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const FROM     = process.env.TWILIO_PHONE_NUMBER;
  const OWNER    = process.env.OWNER_PHONE;

  // Find most recent active booking from this number
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('phone', from)
    .not('status', 'in', '("canceled","completed")')
    .order('created_at', { ascending: false })
    .limit(1);

  const booking = bookings?.[0];
  if (!booking) return res.status(200).send(twiml('We could not find an active booking. Call (858) 988-0325 for help.'));

  const now = new Date().toISOString();

  // ── CONFIRMED / YES ───────────────────────────────────────────────────────
  if (text === 'CONFIRMED' || text === 'YES' || text === 'YES.' || text === 'YES!') {
    await supabase.from('bookings').update({
      status: 'customer_confirmed',
      customer_reply: text,
      customer_reply_at: now
    }).eq('id', booking.id);

    if (OWNER) {
      try {
        await client.messages.create({
          body: `✅ CUSTOMER CONFIRMED\n\n${booking.name}\n${booking.phone}\n${booking.date} at ${booking.time}\n${booking.area}`,
          from: FROM, to: OWNER
        });
      } catch (e) {}
    }
    return res.status(200).send(twiml(`Confirmed! See you on ${booking.date} at ${booking.time}. Call/text (858) 988-0325 if anything changes.`));
  }

  // ── RESCHEDULE ────────────────────────────────────────────────────────────
  if (text === 'RESCHEDULE') {
    await supabase.from('bookings').update({
      status: 'reschedule_requested',
      customer_reply: 'RESCHEDULE',
      customer_reply_at: now
    }).eq('id', booking.id);

    if (OWNER) {
      try {
        await client.messages.create({
          body: `🔄 RESCHEDULE REQUEST\n\n${booking.name}\n${booking.phone}\nCurrent slot: ${booking.date} at ${booking.time}\nLocation: ${booking.area}`,
          from: FROM, to: OWNER
        });
      } catch (e) {}
    }
    return res.status(200).send(twiml('Reschedule request received. We will contact you shortly to find a new time.'));
  }

  // ── NO / STOP / CANCEL ────────────────────────────────────────────────────
  if (['NO', 'NO.', 'NO!', 'STOP', 'CANCEL'].includes(text)) {
    await supabase.from('bookings').update({
      status: 'canceled',
      customer_reply: text,
      customer_reply_at: now
    }).eq('id', booking.id);

    if (OWNER) {
      try {
        await client.messages.create({
          body: `❌ BOOKING CANCELED\n\n${booking.name}\n${booking.phone}\n${booking.date} at ${booking.time}\n${booking.area}`,
          from: FROM, to: OWNER
        });
      } catch (e) {}
    }
    return res.status(200).send(twiml('Your appointment has been canceled. Call (858) 988-0325 if you change your mind.'));
  }

  // ── Unrecognized ──────────────────────────────────────────────────────────
  await supabase.from('bookings').update({
    customer_reply: (body.Body || '').trim().substring(0, 200),
    customer_reply_at: now
  }).eq('id', booking.id);

  return res.status(200).send(twiml('Reply CONFIRMED to confirm, RESCHEDULE to change, or STOP to cancel your appointment.'));
}
