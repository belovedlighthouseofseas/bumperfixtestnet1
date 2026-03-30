// ─────────────────────────────────────────────────────────────────────────────
// /api/incoming-sms.js  —  Vercel serverless function
//
// Twilio webhook — receives inbound SMS replies from customers.
// If the customer replies YES, marks their booking status = 'confirmed'.
//
// Required environment variables (Vercel):
//   SUPABASE_URL         https://xxxx.supabase.co
//   SUPABASE_SECRET_KEY  sb_secret_xxxx
//
// Setup: in Twilio Console → Phone Numbers → your number →
//   Messaging → "A message comes in" → Webhook → set to:
//   https://your-vercel-url.vercel.app/api/incoming-sms
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed.');
  }

  const body = req.body || {};
  const from  = body.From  || '';   // customer's phone number e.g. +16195551234
  const text  = (body.Body || '').trim().toUpperCase();

  console.log(`[incoming-sms] From: ${from} — Message: "${text}"`);

  if (!from) {
    return res.status(400).send('<Response></Response>');
  }

  // Only act on YES replies
  if (text === 'YES' || text === 'YES.' || text === 'YES!') {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Find the most recent booking from this phone number with status 'confirmed'
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, name, date, time, status')
      .eq('phone', from)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[incoming-sms] Supabase error:', error.message);
    } else if (bookings && bookings.length > 0) {
      const booking = bookings[0];

      await supabase
        .from('bookings')
        .update({ status: 'yes_confirmed' })
        .eq('id', booking.id);

      console.log(`[incoming-sms] Booking ${booking.id} marked yes_confirmed — ${booking.name} on ${booking.date} at ${booking.time}`);
    }
  }

  // Respond to Twilio with empty TwiML (no reply text sent back)
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send('<Response></Response>');
}
