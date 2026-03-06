// api/edu.js — Genera scripts educativos para YouTube/TikTok
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    // Auth
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado.' });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    const { eduLabel, eduDesc, city } = req.body;
    if (!eduLabel) return res.status(400).json({ error: 'Tema requerido.' });

    const cityHint = city && city !== 'tu área' ? ` en ${city}` : ' en EE. UU.';

    const prompt = `Eres experto en bienes raíces para la comunidad latina en EE. UU.
Genera un script educativo en español para un video de YouTube o TikTok.
Tema: "${eduLabel}" — ${eduDesc}${cityHint}.
El presentador es un agente de bienes raíces latino.

Devuelve ÚNICAMENTE un objeto JSON válido, sin markdown, sin texto adicional:
{
  "edu_script": "texto completo del script con este formato:\\n\\n[HOOK 0:00-0:05]\\nFrase gancho impactante\\n\\n[INTRO 0:05-0:15]\\nPresentación del agente y tema\\n\\n[PUNTO 1 0:15-0:45]\\nPrimer punto clave\\n\\n[PUNTO 2 0:45-1:15]\\nSegundo punto clave\\n\\n[PUNTO 3 1:15-1:45]\\nTercer punto clave\\n\\n[CTA 1:45-2:00]\\nLlamada a la acción\\n\\n[DESCRIPCIÓN YOUTUBE]\\nDescripción SEO en español\\n\\n[HASHTAGS]\\n#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5 #hashtag6 #hashtag7 #hashtag8 #hashtag9 #hashtag10"
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 2000
      })
    });

    const groqData = await groqRes.json();
    if (groqData.error) {
      return res.status(500).json({ error: groqData.error.message });
    }

    const raw   = groqData.choices?.[0]?.message?.content || '{}';
    let parsed  = {};
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch(e) {
      parsed = { edu_script: raw };
    }

    return res.status(200).json({ success: true, content: parsed });

  } catch(err) {
    console.error('[edu] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
