// api/auth.js — Compatible con Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { action, email, password, name, brokerage } = req.body;

  try {
    // REGISTRO
    if (action === 'register') {
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos.' });
      }
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        if (error.message.includes('already registered')) {
          return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
        }
        return res.status(400).json({ error: error.message });
      }
      if (data.user) {
        await supabase.from('profiles').insert({
          id: data.user.id,
          email,
          name,
          brokerage: brokerage || null,
          plan: 'free',
          listings_used_this_month: 0,
          leads_used_this_month: 0,
          billing_period_start: new Date().toISOString(),
          created_at: new Date().toISOString()
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Cuenta creada. Ahora puedes iniciar sesión.'
      });
    }

    // LOGIN
    if (action === 'login') {
      if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single();

      return res.status(200).json({
        success: true,
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          name: profile?.name,
          brokerage: profile?.brokerage,
          plan: profile?.plan || 'free',
          listings_used: profile?.listings_used_this_month || 0
        }
      });
    }

    // PERFIL
    if (action === 'profile') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No autorizado.' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Sesión inválida.' });
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      return res.status(200).json({ success: true, user: { ...user, ...profile } });
    }

    return res.status(400).json({ error: 'Acción no válida.' });

  } catch (err) {
    console.error('Error en /api/auth:', err);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
};
