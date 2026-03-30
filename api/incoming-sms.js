// /api/incoming-sms.js — Twilio inbound SMS webhook
// Handles YES / NO / RESCHEDULE / STOP replies from customers
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SECRET_KEY;
const OWNER_PHONE   = process.env.OWNER_PHONE;

function twiml(message) {
  if (!message) return '<Response></Response>';
  return `<Response><Message>${message}</Message></Response>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed.');

  const body  = req.body || {};
  const from  = body.From  || '';
  const text  = (body.Body || '').trim().toUpperCase();

  console.log(`[incoming-sms] From: ${from} — Message: "${text}"`);

  res.setHeader('Content-Type', 'text/xml');

  if (!from) return res.status(200).send('<Response></Response>');

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Find the most recent active booking from this number
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('phone', from)
    .in('status', ['confirmed', 'yes_confirmed', 'reschedule_requested'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[incoming-sms] Supabase error:', error.message);
    return res.status(200).send('<Response></Response>');
  }

  if (!bookings || bookings.length === 0) {
    return res.status(200).send(twiml('We could not find an active booking for this number. Call (858) 988-0325 for help.'));
  }

  const booking = bookings[0];
  const client  = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  // ── YES ──────────────────────────────────────────────────────────────────────
  if (text === 'YES' || text === 'YES.' || text === 'YES!') {
    await supabase.from('bookings').update({
      status: 'yes_confirmed',
      customer_reply: 'YES',
      customer_reply_at: new Date().toISOString()
    }).eq('id', booking.id);

    console.log(`[incoming-sms] YES confirmed: ${booking.id}`);

    // Notify owner
    if (OWNER_PHONE) {
      try {
        await client.messages.create({
          body: `✅ Bumper Fix: ${booking.name} confirmed their appointment on ${booking.date} at ${booking.time} in ${booking.area}. Phone: ${from}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: OWNER_PHONE
        });
      } catch (e) { console.error('[incoming-sms] Owner notify error:', e.message); }
    }

    return res.status(200).send(twiml(`Confirmed! See you on ${booking.date} at ${booking.time}. Call/text (858) 988-0325 if anything changes.`));
  }

  // ── RESCHEDULE ───────────────────────────────────────────────────────────────
  if (text === 'RESCHEDULE') {
    await supabase.from('bookings').update({
      status: 'reschedule_requested',
      customer_reply: 'RESCHEDULE',
      customer_reply_at: new Date().toISOString()
    }).eq('id', booking.id);

    // Notify owner
    if (OWNER_PHONE) {
      try {
        await client.messages.create({
          body: `🔄 Bumper Fix: ${booking.name} requested a reschedule for ${booking.date} at ${booking.time}. Phone: ${from}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: OWNER_PHONE
        });
      } catch (e) { console.error('[incoming-sms] Owner notify error:', e.message); }
    }

    return res.status(200).send(twiml('Got it — reschedule request received. We will contact you shortly to find a new time.'));
  }

  // ── NO / STOP / CANCEL ───────────────────────────────────────────────────────
  if (text === 'NO' || text === 'STOP' || text === 'CANCEL' || text === 'NO.' || text === 'NO!') {
    await supabase.from('bookings').update({
      status: 'canceled',
      customer_reply: text,
      customer_reply_at: new Date().toISOString()
    }).eq('id', booking.id);

    if (OWNER_PHONE) {
      try {
        await client.messages.create({
          body: `❌ Bumper Fix: ${booking.name} canceled their appointment on ${booking.date} at ${booking.time}. Phone: ${from}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: OWNER_PHONE
        });
      } catch (e) { console.error('[incoming-sms] Owner notify error:', e.message); }
    }

    return res.status(200).send(twiml('Your appointment has been canceled. Call (858) 988-0325 if you change your mind.'));
  }

  // ── Unrecognized reply ───────────────────────────────────────────────────────
  return res.status(200).send(twiml('Reply YES to confirm, RESCHEDULE to change, or STOP to cancel your appointment.'));
}
