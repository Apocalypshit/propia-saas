// api/share.js — Endpoint público para ver un listing compartido
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  if (!req.query) {
    const url = new URL(req.url, 'http://x');
    req.query = Object.fromEntries(url.searchParams);
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID de listing requerido.' });

  try {
    // Obtener el listing + perfil del agente
    const { data: listing, error } = await supabase
      .from('listings')
      .select('id, address, price, type, tone, content, created_at, user_id')
      .eq('id', id)
      .single();

    if (error || !listing) return res.status(404).json({ error: 'Listing no encontrado.' });

    // Obtener nombre del agente
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, brokerage')
      .eq('id', listing.user_id)
      .single();

    return res.status(200).json({
      success: true,
      listing: {
        id:        listing.id,
        address:   listing.address,
        price:     listing.price,
        type:      listing.type,
        tone:      listing.tone,
        content:   listing.content,
        created_at: listing.created_at
      },
      agent: {
        name:      profile?.name      || 'Agente PropIA',
        brokerage: profile?.brokerage || null
      }
    });

  } catch (err) {
    console.error('Error en /api/share:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
};
