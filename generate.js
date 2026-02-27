// api/generate.js
// Serverless Function de Vercel — La API Key de Groq NUNCA sale del servidor

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Límites por plan
const PLAN_LIMITS = {
  free:       { listings: 5,   leads: 20  },
  basic:      { listings: 50,  leads: 200 },
  pro:        { listings: 200, leads: 1000},
  enterprise: { listings: 999999, leads: 999999 }
};

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // 1. Verificar token del usuario
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No autorizado. Por favor inicia sesión.' });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Sesión inválida. Por favor inicia sesión de nuevo.' });
    }

    // 2. Obtener perfil y plan del usuario
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, listings_used_this_month, billing_period_start')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Perfil no encontrado.' });
    }

    // 3. Verificar límite del plan
    const plan = profile.plan || 'free';
    const limit = PLAN_LIMITS[plan]?.listings || 5;
    const used = profile.listings_used_this_month || 0;

    if (used >= limit) {
      return res.status(429).json({
        error: `Has alcanzado tu límite de ${limit} listings este mes en el plan ${plan.toUpperCase()}.`,
        upgrade: true,
        plan,
        used,
        limit
      });
    }

    // 4. Obtener datos del body
    const { address, price, type, beds, baths, sqft, year, features, tone } = req.body;

    if (!address || !price) {
      return res.status(400).json({ error: 'Dirección y precio son requeridos.' });
    }

    // 5. Construir prompt
    const toneDescriptions = {
      lujoso:       'sofisticado, elegante y exclusivo para compradores de alto poder adquisitivo',
      familiar:     'cálido, acogedor y centrado en el estilo de vida familiar',
      inversionista:'analítico, orientado al ROI y potencial de apreciación',
      moderno:      'fresco, contemporáneo y minimalista para jóvenes profesionales',
      urgente:      'urgencia y escasez, oportunidad única e irrepetible',
      emocional:    'emocional y aspiracional que conecta con los sueños del comprador'
    };

    const prompt = `Eres un experto en marketing de bienes raíces para el mercado latino en Estados Unidos. Genera contenido de marketing profesional en español para la siguiente propiedad.

DATOS DE LA PROPIEDAD:
- Dirección: ${address}
- Precio: ${price}
- Tipo: ${type || 'casa'}
- Recámaras: ${beds || 'No especificado'}
- Baños: ${baths || 'No especificado'}
- Pies cuadrados: ${sqft || 'No especificado'}
- Año de construcción: ${year || 'No especificado'}
- Características especiales: ${features || 'No especificadas'}
- Tono: ${toneDescriptions[tone] || toneDescriptions.lujoso}

Responde ÚNICAMENTE con este JSON exacto (sin markdown, sin backticks):

{
  "mls": "Descripción profesional para MLS de 150-200 palabras. Lenguaje persuasivo y profesional.",
  "posts": [
    "Post 1 para Instagram/Facebook de 80-100 palabras con emojis y 5 hashtags en español al final",
    "Post 2 con ángulo diferente al post 1, mismo formato",
    "Post 3 más emocional o urgente, mismo formato"
  ],
  "email": "Email completo con Asunto: [asunto]\\n\\nCuerpo de 200-250 palabras con saludo, puntos clave y llamada a la acción.",
  "video": "Script para video de 60-90 segundos con gancho inicial, recorrido verbal y llamada a la acción. Indicaciones de escena entre corchetes."
}`;

    // 6. Llamar a Groq (KEY SEGURA en el servidor)
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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

    if (!groqResponse.ok) {
      const errData = await groqResponse.json();
      throw new Error(errData.error?.message || 'Error al contactar el servicio de IA');
    }

    const groqData = await groqResponse.json();
    const rawText = groqData.choices[0]?.message?.content || '';

    let parsed;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error('Error procesando la respuesta de la IA. Intenta de nuevo.');
    }

    // 7. Registrar uso en Supabase
    await supabase
      .from('profiles')
      .update({ listings_used_this_month: used + 1 })
      .eq('id', user.id);

    // 8. Guardar en historial
    await supabase.from('listings').insert({
      user_id: user.id,
      address,
      price,
      type,
      content: parsed,
      created_at: new Date().toISOString()
    });

    // 9. Responder con el contenido generado
    return res.status(200).json({
      success: true,
      content: parsed,
      usage: { used: used + 1, limit, plan }
    });

  } catch (err) {
    console.error('Error en /api/generate:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}
