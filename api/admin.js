// api/admin.js — Panel de administración PropIA
// Protegido por ADMIN_SECRET (variable de entorno en Vercel)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key = bypass RLS
);

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'propia-admin-2024';

function checkAdmin(req) {
  const auth = req.headers['x-admin-secret'] || req.body?.adminSecret || req.query?.secret;
  return auth === ADMIN_SECRET;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAdmin(req)) {
    return res.status(401).json({ error: 'Acceso no autorizado.' });
  }

  const action = req.query.action || req.body?.action;

  // ── GET metrics ───────────────────────────────────────────────
  if (req.method === 'GET' && action === 'metrics') {
    try {
      const [
        { count: totalUsers },
        { count: totalListings },
        { count: totalLeads },
        { data: planBreakdown },
        { data: recentUsers },
        { data: recentListings }
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('listings').select('id', { count: 'exact', head: true }),
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('plan').then(r => ({
          data: r.data?.reduce((acc, p) => {
            acc[p.plan] = (acc[p.plan] || 0) + 1; return acc;
          }, { free: 0, basic: 0, pro: 0, enterprise: 0 })
        })),
        supabase.from('profiles')
          .select('id, name, email, plan, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase.from('listings')
          .select('id, address, price, created_at, user_id')
          .order('created_at', { ascending: false })
          .limit(5)
      ]);

      // MRR estimate
      const prices = { free: 0, basic: 49, pro: 149, enterprise: 399 };
      const mrr = Object.entries(planBreakdown || {}).reduce((sum, [plan, count]) => {
        return sum + (prices[plan] || 0) * count;
      }, 0);

      return res.status(200).json({
        success: true,
        metrics: {
          totalUsers:    totalUsers    || 0,
          totalListings: totalListings || 0,
          totalLeads:    totalLeads    || 0,
          mrr,
          planBreakdown: planBreakdown || {},
          recentUsers:   recentUsers   || [],
          recentListings: recentListings || []
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET users list ────────────────────────────────────────────
  if (req.method === 'GET' && action === 'users') {
    try {
      const page  = parseInt(req.query.page  || '1');
      const limit = parseInt(req.query.limit || '20');
      const search = req.query.search || '';
      const plan   = req.query.plan   || '';
      const offset = (page - 1) * limit;

      let query = supabase
        .from('profiles')
        .select('id, name, email, phone, brokerage, plan, listings_used_this_month, leads_used_this_month, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      if (plan)   query = query.eq('plan', plan);

      const { data: users, count, error } = await query;
      if (error) throw error;

      // Get listing counts per user
      const userIds = (users || []).map(u => u.id);
      let listingCounts = {};
      let leadCounts = {};

      if (userIds.length) {
        const { data: lc } = await supabase
          .from('listings')
          .select('user_id')
          .in('user_id', userIds);
        const { data: ld } = await supabase
          .from('leads')
          .select('agent_id')
          .in('agent_id', userIds);
        (lc || []).forEach(l => { listingCounts[l.user_id] = (listingCounts[l.user_id] || 0) + 1; });
        (ld || []).forEach(l => { leadCounts[l.agent_id]   = (leadCounts[l.agent_id]   || 0) + 1; });
      }

      const enriched = (users || []).map(u => ({
        ...u,
        total_listings: listingCounts[u.id] || 0,
        total_leads:    leadCounts[u.id]    || 0
      }));

      return res.status(200).json({
        success: true,
        users: enriched,
        total: count || 0,
        page, limit
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET user detail ───────────────────────────────────────────
  if (req.method === 'GET' && action === 'user') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido.' });

      const [{ data: profile }, { data: listings }, { data: leads }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('listings').select('id, address, price, type, tone, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
        supabase.from('leads').select('id, name, score, level, status, created_at').eq('agent_id', id).order('created_at', { ascending: false }).limit(20)
      ]);

      return res.status(200).json({
        success: true,
        profile,
        listings: listings || [],
        leads:    leads    || []
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH update user plan ────────────────────────────────────
  if (req.method === 'PATCH' && action === 'update_plan') {
    try {
      const { userId, plan } = req.body;
      const validPlans = ['free', 'basic', 'pro', 'enterprise'];
      if (!userId || !validPlans.includes(plan)) {
        return res.status(400).json({ error: 'userId y plan válido requeridos.' });
      }
      const { error } = await supabase
        .from('profiles')
        .update({ plan })
        .eq('id', userId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE user ───────────────────────────────────────────────
  if (req.method === 'DELETE' && action === 'delete_user') {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId requerido.' });
      // Delete from auth (cascades to profiles via FK)
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Acción no reconocida.' });
};
