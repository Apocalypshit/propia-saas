// api/facebook-auth.js — Guarda tokens de Facebook del agente
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado.' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });

  const { user_token, pages, page_id, page_name, page_token, set_page, disconnect } = req.body;

  try {
    if (disconnect) {
      await supabase.from('profiles').update({
        fb_user_token: null, fb_page_id: null, fb_page_name: null,
        fb_page_token: null, fb_pages: null, fb_connected_at: null
      }).eq('id', user.id);
      return res.status(200).json({ success: true });
    }

    if (set_page) {
      const { data: profile } = await supabase
        .from('profiles').select('fb_pages').eq('id', user.id).single();
      const allPages = JSON.parse(profile?.fb_pages || '[]');
      const selected = allPages.find(p => p.id === set_page);
      if (!selected) return res.status(400).json({ error: 'Página no encontrada.' });
      await supabase.from('profiles').update({
        fb_page_id: selected.id, fb_page_name: selected.name, fb_page_token: selected.access_token
      }).eq('id', user.id);
      return res.status(200).json({ success: true });
    }

    if (!user_token) return res.status(400).json({ error: 'Token requerido.' });

    // Exchange for long-lived token (60 days)
    let longToken = user_token;
    try {
      const url = `https://graph.facebook.com/v22.0/oauth/access_token`
        + `?grant_type=fb_exchange_token`
        + `&client_id=${process.env.FACEBOOK_APP_ID || '1444690334022406'}`
        + `&client_secret=${process.env.FACEBOOK_APP_SECRET}`
        + `&fb_exchange_token=${user_token}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.access_token) longToken = d.access_token;
    } catch(e) { console.warn('[fb-auth] Token exchange failed:', e.message); }

    const updateData = {
      fb_user_token: longToken,
      fb_pages: JSON.stringify(pages || []),
      fb_connected_at: new Date().toISOString()
    };
    if (page_id) {
      updateData.fb_page_id    = page_id;
      updateData.fb_page_name  = page_name;
      updateData.fb_page_token = page_token;
    }

    const { error: dbErr } = await supabase.from('profiles').update(updateData).eq('id', user.id);
    if (dbErr) return res.status(500).json({ error: dbErr.message });

    console.log('[fb-auth] Connected user:', user.id, 'pages:', (pages||[]).length);
    return res.status(200).json({ success: true, pages: (pages||[]).length });

  } catch (err) {
    console.error('[fb-auth] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
