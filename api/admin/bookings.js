// /api/admin/bookings.js — List all bookings (admin only)
import { createClient } from '@supabase/supabase-js';

function checkAuth(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  return token === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ bookings: data || [] });
}
