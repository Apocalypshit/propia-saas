// api/leads.js — CRM de leads con calificación IA
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado.' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });

  // ─── GET — listar leads ───────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('agent_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ success: true, leads: data || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── PATCH — actualizar status ────────────────────────────────
  if (req.method === 'PATCH') {
    try {
      const { id, status, notes } = req.body;
      if (!id) return res.status(400).json({ error: 'ID requerido.' });
      const updates = {};
      if (status) updates.status = status;
      if (notes  !== undefined) updates.notes = notes;
      const { error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .eq('agent_id', user.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── POST — crear lead + calificar con IA ─────────────────────
  if (req.method === 'POST') {
    try {
      const { name, email, phone, interest, budget, message, source } = req.body;
      if (!name) return res.status(400).json({ error: 'El nombre del lead es requerido.' });

      // ── Llamar a Groq para calificación ──
      const prompt = `Eres un experto en bienes raíces especializado en el mercado latino de USA. Analiza este lead inmobiliario y devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown, sin explicaciones.

DATOS DEL LEAD:
- Nombre: ${name}
- Email: ${email || 'No proporcionado'}
- Teléfono: ${phone || 'No proporcionado'}
- Propiedad de interés: ${interest || 'No especificado'}
- Presupuesto: ${budget || 'No especificado'}
- Mensaje/Notas: ${message || 'Sin mensaje'}

Devuelve exactamente este JSON:
{
  "score": <número del 1 al 10>,
  "level": "<Frío|Tibio|Caliente|Listo para cerrar>",
  "analysis": "<2-3 oraciones explicando el score basado en los datos>",
  "steps": ["<acción 1>", "<acción 2>", "<acción 3>"],
  "email_subject": "<asunto del email de seguimiento>",
  "email_body": "<email de seguimiento personalizado de 3-4 párrafos en español, cálido y profesional, con ángulo bicultural latino>"
}

Criterios de scoring:
- 9-10: Tiene presupuesto claro, urgencia, datos de contacto completos
- 7-8: Presupuesto aproximado, interés definido, buen contacto
- 5-6: Interés general, presupuesto vago o sin datos financieros
- 3-4: Información mínima, sin presupuesto claro
- 1-2: Solo curiosidad, sin datos de contacto o presupuesto`;

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1500,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const groqData = await groqRes.json();
      const rawText = groqData.choices?.[0]?.message?.content || '{}';

      let ai = { score: 5, level: 'Tibio', analysis: 'Análisis no disponible.', steps: [], email_subject: '', email_body: '' };
      try {
        const clean = rawText.replace(/```json|```/g, '').trim();
        ai = { ...ai, ...JSON.parse(clean) };
      } catch(e) { console.error('AI parse error:', e.message); }

      // ── Guardar en Supabase ──
      const { data: lead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          agent_id:     user.id,
          name,
          email:        email  || null,
          phone:        phone  || null,
          interest:     interest || null,
          budget:       budget || null,
          message:      message || null,
          source:       source || 'manual',
          status:       'nuevo',
          score:        ai.score,
          level:        ai.level,
          ai_analysis:  ai.analysis,
          ai_steps:     JSON.stringify(ai.steps),
          ai_email_subject: ai.email_subject,
          ai_email_body:    ai.email_body,
          created_at:   new Date().toISOString()
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      return res.status(200).json({ success: true, lead, ai });

    } catch (err) {
      console.error('Error en /api/leads:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido.' });
};
