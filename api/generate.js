// api/generate.js — Compatible con Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_LIMITS = {
  free:       { listings: 5 },
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

    const plan = profile?.plan || 'free';
    const limit = PLAN_LIMITS[plan]?.listings || 5;
    const used = profile?.listings_used_this_month || 0;

    if (used >= limit) {
      return res.status(429).json({
        error: `Alcanzaste tu límite de ${limit} listings este mes.`,
        upgrade: true, plan, used, limit
      });
    }

    const { address, price, type, beds, baths, sqft, year, features, tone } = req.body;
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
  "mls": "descripción profesional de 150 palabras para MLS",
  "posts": [
    "post 1 para Instagram con emojis y hashtags en español",
    "post 2 con ángulo diferente y hashtags en español",
    "post 3 más urgente con hashtags en español"
  ],
  "email": "Asunto: titulo del email aqui\\n\\nHola [Nombre],\\n\\ncuerpo del email aqui de 150 palabras\\n\\nSaludos,\\nTu Agente",
  "video": "script de video de 60 segundos con [indicaciones de escena entre corchetes]"
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
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
        max_tokens: 3000
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

    // Guardar uso
    await supabase.from('profiles')
      .update({ listings_used_this_month: used + 1 }).eq('id', user.id);

    await supabase.from('listings').insert({
      user_id: user.id, address, price, type, tone,
      content: parsed, created_at: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      content: parsed,
      usage: { used: used + 1, limit, plan }
    });

  } catch (err) {
    console.error('Error en /api/generate:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
