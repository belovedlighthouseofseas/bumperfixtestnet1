// ─────────────────────────────────────────────────────────────────────────────
// /api/get-availability.js  —  Vercel serverless function
//
// Returns all booked date+time slots from Supabase so the calendar
// can gray them out in real time.
//
// Required environment variables (Vercel):
//   SUPABASE_URL         https://xxxx.supabase.co
//   SUPABASE_SECRET_KEY  sb_secret_xxxx
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabase
    .from('bookings')
    .select('date, time');

  if (error) {
    console.error('[get-availability] Supabase error:', error.message);
    return res.status(500).json({ error: 'Could not load availability.' });
  }

  // Return array of { date, time } objects
  return res.status(200).json({ booked: data || [] });
}
