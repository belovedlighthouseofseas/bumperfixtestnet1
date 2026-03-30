// /api/get-availability.js — Returns booked slots + blocked slots for the calendar
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  const [bookingsResult, blocksResult] = await Promise.all([
    supabase.from('bookings').select('date, time').not('status', 'eq', 'canceled'),
    supabase.from('blocked_slots').select('date, time')
  ]);

  if (bookingsResult.error) {
    console.error('[get-availability] bookings error:', bookingsResult.error.message);
    return res.status(500).json({ error: 'Could not load availability.' });
  }

  return res.status(200).json({
    booked: bookingsResult.data || [],
    blocked: blocksResult.data || []
  });
}
