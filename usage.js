// api/usage.js
// Consulta el uso actual del usuario y sus límites por plan

import { createClient } from '@supabase/supabase-js';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado.' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, listings_used_this_month, leads_used_this_month, billing_period_start')
      .eq('id', user.id)
      .single();

    const plan = profile?.plan || 'free';
    const limits = PLAN_LIMITS[plan];

    // Resetear contador si ya pasó el mes
    const periodStart = new Date(profile?.billing_period_start || Date.now());
    const now = new Date();
    const daysSincePeriodStart = (now - periodStart) / (1000 * 60 * 60 * 24);

    if (daysSincePeriodStart >= 30) {
      await supabase.from('profiles').update({
        listings_used_this_month: 0,
        leads_used_this_month: 0,
        billing_period_start: now.toISOString()
      }).eq('id', user.id);

      return res.status(200).json({
        plan, planLabel: limits.label,
        listings: { used: 0, limit: limits.listings },
        leads:    { used: 0, limit: limits.leads }
      });
    }

    return res.status(200).json({
      plan, planLabel: limits.label,
      listings: { used: profile?.listings_used_this_month || 0, limit: limits.listings },
      leads:    { used: profile?.leads_used_this_month || 0,    limit: limits.leads }
    });

  } catch (err) {
    console.error('Error en /api/usage:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
