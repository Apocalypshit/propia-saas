// api/upload.js — Sube imágenes a Supabase Storage
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Parse multipart form data manually (Vercel provides raw body)
function parseBase64Body(body) {
  // Expects JSON: { listingId, fileName, fileType, fileData (base64) }
  try { return JSON.parse(body); } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado.' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });

  // ─── DELETE image ─────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const { listingId, imageUrl } = req.body;
      if (!listingId || !imageUrl) return res.status(400).json({ error: 'Datos requeridos.' });

      // Remove from Storage
      const path = imageUrl.split('/listing-images/')[1];
      if (path) await supabase.storage.from('listing-images').remove([path]);

      // Remove URL from listing content
      const { data: listing } = await supabase
        .from('listings').select('content').eq('id', listingId).eq('user_id', user.id).single();
      if (listing) {
        const content = listing.content || {};
        content.images = (content.images || []).filter(url => url !== imageUrl);
        await supabase.from('listings').update({ content }).eq('id', listingId).eq('user_id', user.id);
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── POST upload image ─────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { listingId, fileName, fileType, fileData } = req.body;
      if (!listingId || !fileData) return res.status(400).json({ error: 'Datos requeridos.' });

      // Validate ownership
      const { data: listing } = await supabase
        .from('listings').select('id, content').eq('id', listingId).eq('user_id', user.id).single();
      if (!listing) return res.status(403).json({ error: 'Listing no encontrado.' });

      // Limit: max 10 images per listing
      const existing = listing.content?.images || [];
      if (existing.length >= 10) return res.status(400).json({ error: 'Máximo 10 imágenes por listing.' });

      // Decode base64
      const base64 = fileData.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');

      // File size limit: 8MB
      if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'La imagen no debe superar 8MB.' });

      // Upload to Supabase Storage
      const ext      = (fileName || 'photo.jpg').split('.').pop().toLowerCase();
      const safeName = `${user.id}/${listingId}/${Date.now()}.${ext}`;
      const mime     = fileType || 'image/jpeg';

      const { error: uploadErr } = await supabase.storage
        .from('listing-images')
        .upload(safeName, buffer, { contentType: mime, upsert: false });

      if (uploadErr) throw uploadErr;

      // Get public URL
      const { data: urlData } = supabase.storage.from('listing-images').getPublicUrl(safeName);
      const publicUrl = urlData.publicUrl;

      // Save URL to listing content
      const content   = listing.content || {};
      content.images  = [...existing, publicUrl];
      await supabase.from('listings').update({ content }).eq('id', listingId).eq('user_id', user.id);

      return res.status(200).json({ success: true, url: publicUrl, images: content.images });

    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido.' });
};
