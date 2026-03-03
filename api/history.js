// api/history.js — Historial de listings desde Supabase
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    // 1. Verificar token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado.' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    // 2. Obtener listings del usuario, más recientes primero, máx 50
    const { data: listings, error: dbError } = await supabase
      .from('listings')
      .select('id, address, price, type, tone, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (dbError) throw new Error(dbError.message);

    return res.status(200).json({
      success: true,
      listings: listings || []
    });

  } catch (err) {
    console.error('Error en /api/history:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};
