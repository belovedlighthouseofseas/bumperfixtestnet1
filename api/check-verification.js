// ─────────────────────────────────────────────────────────────────────────────
// /api/check-verification.js  —  Next.js API route
//
// 1. Verifies the 6-digit Twilio code submitted by the user.
// 2. Checks the in-memory slot store for conflicts (HTTP 409 if taken).
// 3. Creates a booking record in temporary in-memory storage.
// 4. Sends a final SMS confirmation via Twilio Messages.
//
// ⚠️  TEMPORARY STORAGE — bookings live only as long as the server process.
//     On restart, all in-memory bookings are lost. This is intentional for the
//     testing phase. See the DB_REPLACE markers below to swap in a real store.
//
// Required environment variables (.env.local):
//   TWILIO_ACCOUNT_SID         ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN          your_auth_token
//   TWILIO_VERIFY_SERVICE_SID  VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_PHONE_NUMBER        +1XXXXXXXXXX  (your Twilio sending number)
// ─────────────────────────────────────────────────────────────────────────────

import twilio      from 'twilio';
import { randomUUID } from 'crypto';

// ── Environment variable validation ──────────────────────────────────────────
const ACCOUNT_SID        = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN         = process.env.TWILIO_AUTH_TOKEN;
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;
const TWILIO_PHONE       = process.env.TWILIO_PHONE_NUMBER;

function missingEnvVars() {
  const missing = [];
  if (!ACCOUNT_SID)        missing.push('TWILIO_ACCOUNT_SID');
  if (!AUTH_TOKEN)         missing.push('TWILIO_AUTH_TOKEN');
  if (!VERIFY_SERVICE_SID) missing.push('TWILIO_VERIFY_SERVICE_SID');
  if (!TWILIO_PHONE)       missing.push('TWILIO_PHONE_NUMBER');
  return missing;
}

// ─── TEMPORARY IN-MEMORY STORE ───────────────────────────────────────────────
// TODO: replace in-memory store with persistent database (Supabase, Postgres, etc.)
// current implementation resets on server restart — intentional for testing phase.
//
// Key: `${date}|${time}`  →  Value: full booking object
// DB_REPLACE: swap Map operations below for INSERT / SELECT queries
const bookings = new Map();
// ─────────────────────────────────────────────────────────────────────────────

// ── Phone normalizer → E.164 ──────────────────────────────────────────────────
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

// ── Route handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Fail fast if Twilio is not configured
  const missing = missingEnvVars();
  if (missing.length > 0) {
    console.error('[check-verification] Missing env vars:', missing.join(', '));
    return res.status(500).json({
      error: 'Booking service is not configured. Please contact us directly at (858) 988-0325.'
    });
  }

  const { phone, code, name, area, notes, date, time } = req.body || {};

  // ── Input validation ───────────────────────────────────────────────────────
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

  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

  // ── 1. Verify the code with Twilio ────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await client.verify.v2
      .services(VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to:   normalized,
        code: code.trim()
      });
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

  // ── 2. Check for slot conflict ────────────────────────────────────────────
  // DB_REPLACE: replace this Map lookup with a database query:
  //   SELECT id FROM bookings WHERE date = $1 AND time = $2 LIMIT 1
  const slotKey = `${date}|${time}`;
  if (bookings.has(slotKey)) {
    return res.status(409).json({
      error: 'That time slot was just taken by another customer. Please choose a different time.'
    });
  }

  // ── 3. Create booking in temporary store ──────────────────────────────────
  const booking = {
    id:        randomUUID(),
    name:      name.trim(),
    phone:     normalized,
    area:      area.trim(),
    notes:     notes ? notes.trim() : '',
    date,
    time,
    createdAt: new Date().toISOString(),
    status:    'verified'   // status values: 'verified' | 'confirmed'
  };

  // DB_REPLACE: replace this Map.set() with a database insert:
  //   INSERT INTO bookings (id, name, phone, area, notes, date, time, created_at, status)
  //   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  bookings.set(slotKey, booking);
  console.log(`[check-verification] Booking created: ${booking.id} — ${date} at ${time} for ${name} (${area})`);

  // ── 4. Send final confirmation SMS ────────────────────────────────────────
  const confirmationMsg =
    `Bumper Fix: your booking request is locked in for ${date} at ${time} in ${area}. ` +
    `Reply YES to confirm availability or call (858) 988-0325 to reschedule.`;

  try {
    await client.messages.create({
      body: confirmationMsg,
      from: TWILIO_PHONE,
      to:   normalized
    });
    // DB_REPLACE: update booking status to 'confirmed' after SMS sends:
    //   UPDATE bookings SET status = 'confirmed' WHERE id = $1
    booking.status = 'confirmed';
    console.log(`[check-verification] Confirmation SMS sent to ${normalized}`);
  } catch (smsErr) {
    // Booking is already reserved — log the SMS failure but do not block success
    console.error('[check-verification] Confirmation SMS failed:', smsErr.message);
  }

  return res.status(200).json({
    success: true,
    booking: {
      id:    booking.id,
      name:  booking.name,
      date:  booking.date,
      time:  booking.time,
      area:  booking.area,
      status: booking.status
    }
  });
}
