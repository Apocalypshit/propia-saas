// api/usage.js — Compatible con Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_LIMITS = {
  free:       { listings: 5,      leads: 20,    label: 'Gratis' },
  basic:      { listings: 50,     leads: 200,   label: 'Básico — $49/mes' },
  pro:        { listings: 200,    leads: 1000,  label: 'Pro — $149/mes' },
  enterprise: { listings: 99999,  leads: 99999, label: 'Empresarial — $399/mes' }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado.' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, listings_used_this_month, leads_used_this_month, billing_period_start')
      .eq('id', user.id).single();

    const plan = profile?.plan || 'free';
    const limits = PLAN_LIMITS[plan];

    return res.status(200).json({
      plan,
      planLabel: limits.label,
      listings: { used: profile?.listings_used_this_month || 0, limit: limits.listings },
      leads:    { used: profile?.leads_used_this_month || 0,    limit: limits.leads }
    });

  } catch (err) {
    console.error('Error en /api/usage:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};
