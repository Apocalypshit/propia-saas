// api/facebook.js — Facebook integration (auth + post)
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

  const body = req.body || {};

  // ── ROUTE BY ACTION ───────────────────────────────────────────
  // action: 'connect' | 'disconnect' | 'set_page' | 'post'
  const action = body.action || (body.listingId ? 'post' : body.disconnect ? 'disconnect' : body.set_page ? 'set_page' : 'connect');

  try {
    // ── CONNECT — save tokens from FB SDK ────────────────────────
    if (action === 'connect') {
      const { user_token, pages, page_id, page_name, page_token } = body;
      if (!user_token) return res.status(400).json({ error: 'Token requerido.' });

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
      } catch(e) { console.warn('[fb] Token exchange failed:', e.message); }

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
      console.log('[fb] Connected user:', user.id, 'pages:', (pages||[]).length);
      return res.status(200).json({ success: true, pages: (pages||[]).length });
    }

    // ── DISCONNECT ────────────────────────────────────────────────
    if (action === 'disconnect') {
      await supabase.from('profiles').update({
        fb_user_token: null, fb_page_id: null, fb_page_name: null,
        fb_page_token: null, fb_pages: null, fb_connected_at: null
      }).eq('id', user.id);
      return res.status(200).json({ success: true });
    }

    // ── SET PAGE ──────────────────────────────────────────────────
    if (action === 'set_page') {
      const { set_page } = body;
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

    // ── POST to Facebook Page ─────────────────────────────────────
    if (action === 'post') {
      const { listingId, pageId } = body;

      const { data: profile } = await supabase
        .from('profiles')
        .select('fb_page_token, fb_page_id, fb_page_name, fb_pages')
        .eq('id', user.id).single();

      if (!profile?.fb_page_token) {
        return res.status(400).json({ error: 'No tienes Facebook conectado. Ve a Integraciones.' });
      }

      const { data: listing } = await supabase
        .from('listings').select('*').eq('id', listingId).eq('user_id', user.id).single();
      if (!listing) return res.status(404).json({ error: 'Listing no encontrado.' });

      const targetPageId    = pageId || profile.fb_page_id;
      const targetPageToken = getPageToken(profile, targetPageId);
      if (!targetPageId || !targetPageToken) {
        return res.status(400).json({ error: 'Selecciona una página de Facebook en Integraciones.' });
      }

      const content  = listing.content || {};
      const fbPost   = content.facebook_post || content.instagram_post || content.description || '';
      const postMsg  = fbPost
        + (listing.address ? '\n\n📍 ' + listing.address : '')
        + (listing.price   ? '\n💰 ' + listing.price : '')
        + '\n\n🏠 PropIA — IA para Agentes Latinos\n#bienesraices #realestate #casas';

      const fbRes  = await fetch(`https://graph.facebook.com/v22.0/${targetPageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: postMsg, access_token: targetPageToken })
      });
      const fbData = await fbRes.json();

      if (fbData.error) {
        console.error('[fb] Post error:', fbData.error.message);
        return res.status(400).json({ error: fbData.error.message });
      }

      console.log('[fb] Published:', fbData.id, 'user:', user.id);
      return res.status(200).json({
        success:  true,
        post_id:  fbData.id,
        post_url: `https://facebook.com/${fbData.id}`,
        page:     profile.fb_page_name || targetPageId
      });
    }

    return res.status(400).json({ error: 'Acción no reconocida.' });

  } catch (err) {
    console.error('[fb] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function getPageToken(profile, pageId) {
  if (profile.fb_page_id === pageId && profile.fb_page_token) return profile.fb_page_token;
  try {
    const pages = JSON.parse(profile.fb_pages || '[]');
    const page  = pages.find(p => p.id === pageId);
    return page ? page.access_token : null;
  } catch(e) { return null; }
}
