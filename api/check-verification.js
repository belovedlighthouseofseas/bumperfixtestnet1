// /api/check-verification.js — Vercel serverless function
// Verifies Twilio code, saves booking as "awaiting_review", sends owner alert SMS
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (cleaned.startsWith('+')) return cleaned.replace(/\s/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length > 7) return '+' + digits;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { phone, code, name, area, notes, date, time } = req.body || {};

  if (!phone || !code || !name || !area || !date || !time)
    return res.status(400).json({ error: 'Missing required booking fields.' });
  if (typeof code !== 'string' || code.replace(/\D/g, '').length !== 6)
    return res.status(400).json({ error: 'Please enter the full 6-digit verification code.' });

  const normalized = normalizePhone(phone);
  if (!normalized) return res.status(400).json({ error: 'Invalid phone number format.' });

  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const supabase     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  // ── 1. Verify code ────────────────────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: normalized, code: code.trim() });
  } catch (err) {
    return res.status(500).json({ error: 'Verification check failed. Please try again or call (858) 988-0325.' });
  }

  if (verificationResult.status !== 'approved')
    return res.status(400).json({ error: 'Incorrect code. Please double-check and try again.' });

  // ── 2. Check slot conflict ────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('bookings')
    .select('id')
    .eq('date', date)
    .eq('time', time)
    .not('status', 'eq', 'canceled')
    .limit(1);

  if (existing && existing.length > 0)
    return res.status(409).json({ error: 'That time slot was just taken. Please choose a different time.' });

  // ── 3. Save booking as awaiting_review ────────────────────────────────────
  const { data: booking, error: insertError } = await supabase
    .from('bookings')
    .insert({
      name:       name.trim(),
      phone:      normalized,
      area:       area.trim(),
      notes:      notes ? notes.trim() : '',
      date,
      time,
      status:     'awaiting_review',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (insertError) {
    console.error('[check-verification] Insert error:', insertError.message);
    return res.status(500).json({ error: 'Could not save booking. Please try again.' });
  }

  // ── 4. Send customer "request received" SMS ───────────────────────────────
  try {
    await twilioClient.messages.create({
      body: `Bumper Fix: Booking request received for ${date} at ${time} in ${area}.\n\nWe will review and confirm shortly. Questions? Call/text (858) 988-0325.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   normalized
    });
  } catch (e) { console.error('[check-verification] Customer SMS failed:', e.message); }

  // ── 5. Send owner alert SMS ───────────────────────────────────────────────
  if (process.env.OWNER_PHONE) {
    try {
      await twilioClient.messages.create({
        body: `NEW BUMPER FIX BOOKING\n\n${name.trim()}\n${normalized}\n${date} at ${time}\n${area.trim()}\n\nStatus: Awaiting review`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to:   process.env.OWNER_PHONE
      });
    } catch (e) { console.error('[check-verification] Owner SMS failed:', e.message); }
  }

  return res.status(200).json({
    success: true,
    booking: { id: booking.id, name: booking.name, date: booking.date, time: booking.time, area: booking.area, status: booking.status }
  });
}
