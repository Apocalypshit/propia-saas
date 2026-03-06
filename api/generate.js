// api/generate.js — Compatible con Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_LIMITS = {
  free:       { listings: 2 },  // 2 listings totales por cuenta
  basic:      { listings: 50 },
  pro:        { listings: 200 },
  enterprise: { listings: 99999 }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado. Por favor inicia sesión.' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    const { data: profile } = await supabase
      .from('profiles').select('plan, listings_used_this_month').eq('id', user.id).single();

    // For free plan: count total listings ever created (not monthly)
    let totalListings = 0;
    if ((profile?.plan || 'free') === 'free') {
      const { count } = await supabase
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      totalListings = count || 0;
    }

    const { address, price, type, beds, baths, sqft, year, features, tone, listingId } = req.body;

    const plan = profile?.plan || 'free';
    const limit = PLAN_LIMITS[plan]?.listings || 2;
    const used = plan === 'free' ? totalListings : (profile?.listings_used_this_month || 0);

    if (!listingId && used >= limit) {
      return res.status(429).json({
        error: `Alcanzaste tu límite de ${limit} listings en el plan gratuito.`,
        upgrade: true, plan, used, limit
      });
    }
    if (!address || !price) return res.status(400).json({ error: 'Dirección y precio son requeridos.' });

    const toneDesc = {
      lujoso: 'sofisticado y elegante',
      familiar: 'cálido y familiar',
      inversionista: 'analítico y orientado al ROI',
      moderno: 'fresco y contemporáneo',
      urgente: 'urgente, oportunidad única',
      emocional: 'emocional y aspiracional'
    };

    // Prompt simplificado para que Groq devuelva JSON limpio y consistente
    const prompt = `Eres experto en marketing de bienes raíces para latinos en USA. 
Genera contenido de marketing en español con tono ${toneDesc[tone] || 'profesional'} para esta propiedad:

Dirección: ${address}
Precio: ${price}
Tipo: ${type || 'casa'}
Recámaras: ${beds || 'N/A'} | Baños: ${baths || 'N/A'}
Pies cuadrados: ${sqft || 'N/A'} | Año: ${year || 'N/A'}
Características: ${features || 'No especificadas'}

Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta, sin texto adicional, sin explicaciones, sin markdown:
{
  "mls": "descripción profesional de 120 palabras para MLS",
  "posts": [
    "post 1 para Instagram con emojis y hashtags en español",
    "post 2 con ángulo diferente y hashtags en español",
    "post 3 más urgente con hashtags en español"
  ],
  "email": "Asunto: titulo del email aqui\\n\\nHola [Nombre],\\n\\ncuerpo del email de 100 palabras\\n\\nSaludos,\\nTu Agente",
  "video": "[HOOK 0:00] frase gancho de apertura\n[PROPIEDAD 0:05] presentar la propiedad\n[CARACTERISTICAS 0:15] mencionar 3 puntos clave de la propiedad\n[PRECIO Y ZONA 0:35] precio y ubicacion\n[CTA 0:45] como contactar al agente\n[CIERRE 0:55] frase final memorable"
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente que SOLO responde con JSON válido. Nunca incluyas markdown, backticks, ni texto fuera del JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      throw new Error(err.error?.message || 'Error al contactar la IA');
    }

    const groqData = await groqRes.json();
    let rawText = groqData.choices[0]?.message?.content || '';

    // Limpieza agresiva del texto para extraer el JSON
    rawText = rawText.trim();
    rawText = rawText.replace(/^```json\s*/i, '');
    rawText = rawText.replace(/^```\s*/i, '');
    rawText = rawText.replace(/\s*```$/i, '');
    rawText = rawText.trim();

    // Si no empieza con { buscar el primer {
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      rawText = rawText.substring(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      // Si aún falla, devolver estructura básica con el texto crudo
      console.error('JSON parse error:', parseErr.message);
      console.error('Raw text received:', rawText.substring(0, 500));
      parsed = {
        mls: rawText.substring(0, 500) || 'Error generando contenido. Intenta de nuevo.',
        posts: ['Intenta generar de nuevo para obtener los posts.', '', ''],
        email: 'Intenta generar de nuevo para obtener el email.',
        video: 'Intenta generar de nuevo para obtener el script de video.'
      };
    }

    // Guardar campos del formulario en _meta para poder pre-llenar al editar
    parsed._meta = {
      beds: beds || '', baths: baths || '', sqft: sqft || '',
      year: year || '', features: features || '', type: type || 'casa'
    };

    if (listingId) {
      // EDITAR listing existente — no incrementar contador
      await supabase.from('listings')
        .update({ address, price, type, tone, content: parsed })
        .eq('id', listingId).eq('user_id', user.id);
    } else {
      // NUEVO listing — incrementar contador e insertar
      await supabase.from('profiles')
        .update({ listings_used_this_month: used + 1 }).eq('id', user.id);
      await supabase.from('listings').insert({
        user_id: user.id, address, price, type, tone,
        content: parsed, created_at: new Date().toISOString()
      });
    }

    // ── AUTO-PUBLISH: Facebook + Email a leads ───────────────────
    // Only on NEW listings (not edits), fire-and-forget (no await)
    if (!listingId) {
      autoPublish(user.id, address, price, parsed).catch(function(e){
        console.error('[auto-publish] Error:', e.message);
      });
    }

    return res.status(200).json({
      success: true,
      content: parsed,
      listingId: listingId || null,
      usage: { used: listingId ? used : used + 1, limit, plan }
    });

  } catch (err) {
    console.error('Error en /api/generate:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};

// ── AUTO-PUBLISH: Facebook + Email leads ─────────────────────────
async function autoPublish(userId, address, price, content) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const APP_URL   = process.env.APP_URL || 'https://propia-saas.vercel.app';

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, fb_page_token, fb_page_id, fb_page_name')
    .eq('id', userId).single();

  if (!profile) return;
  const agentName = profile.name || 'Tu agente de bienes raíces';

  // 1. POST TO FACEBOOK
  if (profile.fb_page_token && profile.fb_page_id) {
    try {
      const fbPost  = content.facebook_post || content.description || '';
      const postMsg = fbPost
        + '\n\n📍 ' + address
        + (price ? '\n💰 ' + price : '')
        + '\n\n🏠 ' + agentName + ' | PropIA\n#bienesraices #realestate #casas';
      const fbRes  = await fetch(`https://graph.facebook.com/v22.0/${profile.fb_page_id}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: postMsg, access_token: profile.fb_page_token })
      });
      const fbData = await fbRes.json();
      if (fbData.error) console.error('[auto-publish] FB:', fbData.error.message);
      else console.log('[auto-publish] FB published:', fbData.id);
    } catch(e) { console.error('[auto-publish] FB exception:', e.message); }
  }

  // 2. EMAIL TO ACTIVE LEADS
  if (!RESEND_KEY) return;
  const { data: leads } = await supabase
    .from('leads').select('id, name, email')
    .eq('user_id', userId).neq('status', 'cerrado').not('email', 'is', null);
  if (!leads || leads.length === 0) return;

  const subject   = (content.email_subject || 'Nueva propiedad disponible') + ' — ' + address;
  const emailBody = content.email_body || content.description || '';
  const shareLink = APP_URL + '/share?agent=' + userId;

  for (const lead of leads) {
    if (!lead.email) continue;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
        body: JSON.stringify({
          from: 'PropIA <onboarding@resend.dev>',
          to:   lead.email,
          subject,
          html: buildLeadEmail({ leadName: lead.name || 'Estimado cliente', agentName, address, price, emailBody, shareLink })
        })
      });
      console.log('[auto-publish] Email sent to lead:', lead.id);
    } catch(e) { console.error('[auto-publish] Email error:', e.message); }
  }
}

function buildLeadEmail({ leadName, agentName, address, price, emailBody, shareLink }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eae5f8;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(124,58,237,.12)">
  <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:28px 32px">
    <div style="font-size:22px;font-weight:900;color:white">PropIA</div>
    <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px">Nueva propiedad disponible para ti</div>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:15px;color:#374151;margin:0 0 16px">Hola <strong>${leadName}</strong>,</p>
    <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 20px">${emailBody}</p>
    <div style="background:#f8f6ff;border:1.5px solid rgba(124,58,237,.12);border-radius:14px;padding:20px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Propiedad</div>
      <div style="font-size:18px;font-weight:800;color:#0f0a1e;margin-bottom:6px">📍 ${address}</div>
      ${price ? `<div style="font-size:22px;font-weight:900;color:#7c3aed">💰 ${price}</div>` : ''}
    </div>
    <a href="${shareLink}" style="display:block;background:#7c3aed;color:white;text-align:center;padding:14px;border-radius:12px;font-size:14px;font-weight:700;text-decoration:none;margin-bottom:24px">Ver propiedad completa →</a>
    <p style="font-size:13px;color:#9ca3af;margin:0">Con gusto, <strong style="color:#374151">${agentName}</strong><br>
    <span style="font-size:12px">Enviado via PropIA — IA para Agentes Latinos</span></p>
  </div>
  <div style="background:#f8f6ff;padding:16px 32px;text-align:center">
    <p style="font-size:11px;color:#9ca3af;margin:0">Recibiste este email porque estás en la lista de contactos de ${agentName}.</p>
  </div>
</div>
</body></html>`;
}
