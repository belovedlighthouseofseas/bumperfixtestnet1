// /api/admin/block-slot.js — Block a date or time slot (admin only)
import { createClient } from '@supabase/supabase-js';

function checkAuth(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  return token === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  // DELETE a block
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id.' });
    const { error } = await supabase.from('blocked_slots').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // CREATE a block
  if (req.method === 'POST') {
    const { date, time, reason } = req.body || {};
    if (!date) return res.status(400).json({ error: 'Date is required.' });

    const { data, error } = await supabase
      .from('blocked_slots')
      .insert({ date, time: time || null, reason: reason || '' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, block: data });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
