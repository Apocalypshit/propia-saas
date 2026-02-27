// api/generate.js — Compatible con Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_LIMITS = {
  free:       { listings: 5   },
  basic:      { listings: 50  },
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
    if (authError || !user) return res.status(401).json({ error: 'Sesión inválida. Por favor inicia sesión de nuevo.' });

    const { data: profile } = await supabase
      .from('profiles').select('plan, listings_used_this_month').eq('id', user.id).single();

    const plan = profile?.plan || 'free';
    const limit = PLAN_LIMITS[plan]?.listings || 5;
    const used = profile?.listings_used_this_month || 0;

    if (used >= limit) {
      return res.status(429).json({
        error: `Alcanzaste tu límite de ${limit} listings este mes en el plan ${plan.toUpperCase()}.`,
        upgrade: true, plan, used, limit
      });
    }

    const { address, price, type, beds, baths, sqft, year, features, tone } = req.body;
    if (!address || !price) return res.status(400).json({ error: 'Dirección y precio son requeridos.' });

    const toneDesc = {
      lujoso: 'sofisticado, elegante y exclusivo',
      familiar: 'cálido, acogedor y centrado en la familia',
      inversionista: 'analítico, orientado al ROI',
      moderno: 'fresco, contemporáneo y minimalista',
      urgente: 'urgencia y escasez, oportunidad única',
      emocional: 'emocional y aspiracional'
    };

    const prompt = `Eres experto en marketing de bienes raíces para latinos en USA. Genera contenido en español con tono ${toneDesc[tone] || toneDesc.lujoso}.

PROPIEDAD:
- Dirección: ${address}
- Precio: ${price}
- Tipo: ${type || 'casa'}
- Recámaras: ${beds || 'N/A'} | Baños: ${baths || 'N/A'}
- Pies cuadrados: ${sqft || 'N/A'} | Año: ${year || 'N/A'}
- Características: ${features || 'No especificadas'}

Responde SOLO con este JSON (sin markdown ni backticks):
{"mls":"descripción MLS de 150-200 palabras","posts":["post 1 con emojis y hashtags en español","post 2 diferente al 1","post 3 más urgente"],"email":"Asunto: [asunto]\\n\\nCuerpo del email completo de 200 palabras","video":"Script de 60-90 segundos con [indicaciones de escena]"}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.75,
        max_tokens: 3000
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      throw new Error(err.error?.message || 'Error al contactar la IA');
    }

    const groqData = await groqRes.json();
    const rawText = groqData.choices[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      throw new Error('Error procesando respuesta de la IA. Intenta de nuevo.');
    }

    await supabase.from('profiles')
      .update({ listings_used_this_month: used + 1 }).eq('id', user.id);

    await supabase.from('listings').insert({
      user_id: user.id, address, price, type, tone, content: parsed,
      created_at: new Date().toISOString()
    });

    return res.status(200).json({
      success: true, content: parsed,
      usage: { used: used + 1, limit, plan }
    });

  } catch (err) {
    console.error('Error en /api/generate:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
