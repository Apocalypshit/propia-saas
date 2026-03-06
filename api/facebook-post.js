// api/facebook-post.js — Publica contenido en la Facebook Page del agente
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

  // Auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado.' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });

  const { listingId, pageId, postType } = req.body;
  // postType: 'facebook_post' | 'instagram_post' (future)

  try {
    // Get agent profile with FB tokens
    const { data: profile } = await supabase
      .from('profiles')
      .select('fb_page_token, fb_page_id, fb_page_name, fb_user_token, fb_pages, name')
      .eq('id', user.id)
      .single();

    if (!profile?.fb_page_token && !profile?.fb_user_token) {
      return res.status(400).json({ error: 'No tienes Facebook conectado. Ve a Configuración → Integraciones.' });
    }

    // Get listing content
    const { data: listing } = await supabase
      .from('listings')
      .select('*')
      .eq('id', listingId)
      .eq('user_id', user.id)
      .single();

    if (!listing) return res.status(404).json({ error: 'Listing no encontrado.' });

    // Determine which page to post to
    const targetPageId    = pageId || profile.fb_page_id;
    const targetPageToken = getPageToken(profile, targetPageId);

    if (!targetPageId || !targetPageToken) {
      return res.status(400).json({ error: 'Selecciona una página de Facebook primero.' });
    }

    // Build post content from listing
    const content    = listing.content || {};
    const fbPost     = content.facebook_post || content.instagram_post || '';
    const address    = listing.address || '';
    const price      = listing.price || '';

    const postMessage = fbPost
      + '\n\n📍 ' + address
      + (price ? '\n💰 ' + price : '')
      + '\n\n🏠 Generado con PropIA — IA para Agentes Latinos\n#bienesraices #realestate #casas';

    // Publish to Facebook Page
    const fbRes = await fetch(
      `https://graph.facebook.com/v22.0/${targetPageId}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:      postMessage,
          access_token: targetPageToken
        })
      }
    );

    const fbData = await fbRes.json();

    if (fbData.error) {
      console.error('[fb-post] FB API error:', fbData.error.message);
      return res.status(400).json({ error: fbData.error.message });
    }

    // Log the post
    console.log('[fb-post] Published:', fbData.id, 'for user:', user.id);

    // Save post record to listing content
    const existingPosts = listing.content?.fb_posts || [];
    await supabase.from('listings').update({
      content: {
        ...listing.content,
        fb_posts: [...existingPosts, {
          post_id:    fbData.id,
          page_id:    targetPageId,
          published_at: new Date().toISOString()
        }]
      }
    }).eq('id', listingId);

    return res.status(200).json({
      success:  true,
      post_id:  fbData.id,
      post_url: `https://facebook.com/${fbData.id}`,
      page:     profile.fb_page_name || targetPageId
    });

  } catch (err) {
    console.error('[fb-post] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function getPageToken(profile, pageId) {
  // If matches saved page, return saved token
  if (profile.fb_page_id === pageId && profile.fb_page_token) {
    return profile.fb_page_token;
  }
  // Look in fb_pages JSON
  try {
    const pages = JSON.parse(profile.fb_pages || '[]');
    const page  = pages.find(function(p) { return p.id === pageId; });
    return page ? page.access_token : null;
  } catch (e) {
    return null;
  }
}
