// ─────────────────────────────────────────────────────────────────────────────
// /api/check-verification.js  —  Vercel serverless function
//
// 1. Verifies the 6-digit Twilio code submitted by the user.
// 2. Checks Supabase for slot conflicts (HTTP 409 if taken).
// 3. Creates a booking record in Supabase.
// 4. Sends a final SMS confirmation via Twilio Messages.
//
// Required environment variables (Vercel):
//   TWILIO_ACCOUNT_SID         ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN          your_auth_token
//   TWILIO_VERIFY_SERVICE_SID  VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_PHONE_NUMBER        +1XXXXXXXXXX
//   SUPABASE_URL               https://xxxx.supabase.co
//   SUPABASE_SECRET_KEY        sb_secret_xxxx
// ─────────────────────────────────────────────────────────────────────────────

import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const ACCOUNT_SID        = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN         = process.env.TWILIO_AUTH_TOKEN;
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;
const TWILIO_PHONE       = process.env.TWILIO_PHONE_NUMBER;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_SECRET_KEY;

function missingEnvVars() {
  const missing = [];
  if (!ACCOUNT_SID)        missing.push('TWILIO_ACCOUNT_SID');
  if (!AUTH_TOKEN)         missing.push('TWILIO_AUTH_TOKEN');
  if (!VERIFY_SERVICE_SID) missing.push('TWILIO_VERIFY_SERVICE_SID');
  if (!TWILIO_PHONE)       missing.push('TWILIO_PHONE_NUMBER');
  if (!SUPABASE_URL)       missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY)       missing.push('SUPABASE_SECRET_KEY');
  return missing;
}

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (cleaned.startsWith('+')) return cleaned.replace(/\s/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length > 7)   return '+' + digits;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const missing = missingEnvVars();
  if (missing.length > 0) {
    console.error('[check-verification] Missing env vars:', missing.join(', '));
    return res.status(500).json({
      error: 'Booking service is not configured. Please contact us directly at (858) 988-0325.'
    });
  }

  const { phone, code, name, area, notes, date, time } = req.body || {};

  if (!phone || !code || !name || !area || !date || !time) {
    return res.status(400).json({ error: 'Missing required booking fields.' });
  }
  if (typeof code !== 'string' || code.replace(/\D/g, '').length !== 6) {
    return res.status(400).json({ error: 'Please enter the full 6-digit verification code.' });
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return res.status(400).json({ error: 'Invalid phone number format.' });
  }

  const twilioClient = twilio(ACCOUNT_SID, AUTH_TOKEN);
  const supabase     = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── 1. Verify the code with Twilio ────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await twilioClient.verify.v2
      .services(VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: normalized, code: code.trim() });
  } catch (err) {
    console.error('[check-verification] Twilio verify error:', err.message);
    return res.status(500).json({
      error: 'Verification check failed. Please try again or call (858) 988-0325.'
    });
  }

  if (verificationResult.status !== 'approved') {
    return res.status(400).json({
      error: 'Incorrect code. Please double-check the code we sent and try again.'
    });
  }

  // ── 2. Check for slot conflict in Supabase ────────────────────────────────
  const { data: existing, error: selectError } = await supabase
    .from('bookings')
    .select('id')
    .eq('date', date)
    .eq('time', time)
    .limit(1);

  if (selectError) {
    console.error('[check-verification] Supabase select error:', selectError.message);
    return res.status(500).json({ error: 'Could not check availability. Please try again.' });
  }

  if (existing && existing.length > 0) {
    return res.status(409).json({
      error: 'That time slot was just taken by another customer. Please choose a different time.'
    });
  }

  // ── 3. Insert booking into Supabase ───────────────────────────────────────
  const { data: booking, error: insertError } = await supabase
    .from('bookings')
    .insert({
      name:   name.trim(),
      phone:  normalized,
      area:   area.trim(),
      notes:  notes ? notes.trim() : '',
      date,
      time,
      status: 'confirmed'
    })
    .select()
    .single();

  if (insertError) {
    console.error('[check-verification] Supabase insert error:', insertError.message);
    return res.status(500).json({ error: 'Could not save booking. Please try again.' });
  }

  console.log(`[check-verification] Booking saved: ${booking.id} — ${date} at ${time} for ${name} (${area})`);

  // ── 4. Send final confirmation SMS ────────────────────────────────────────
  const confirmationMsg =
    `Bumper Fix: your booking request is locked in for ${date} at ${time} in ${area}. ` +
    `Reply YES to confirm availability or call (858) 988-0325 to reschedule.`;

  try {
    await twilioClient.messages.create({ body: confirmationMsg, from: TWILIO_PHONE, to: normalized });
    console.log(`[check-verification] Confirmation SMS sent to ${normalized}`);
  } catch (smsErr) {
    console.error('[check-verification] Confirmation SMS failed:', smsErr.message);
  }

  return res.status(200).json({
    success: true,
    booking: {
      id:     booking.id,
      name:   booking.name,
      date:   booking.date,
      time:   booking.time,
      area:   booking.area,
      status: booking.status
    }
  });
}
