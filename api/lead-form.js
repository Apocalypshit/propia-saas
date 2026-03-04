// api/lead-form.js — Endpoint público para formulario de leads
// No requiere autenticación — el lead se registra por cuenta propia
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — devolver nombre del agente para mostrar en la página pública
  if (req.method === 'GET') {
    try {
      if (!req.query) { const u = new URL(req.url,'http://x'); req.query = Object.fromEntries(u.searchParams); }
      const agent_id = req.query?.agent;
      if (!agent_id) return res.status(400).json({ error: 'Agente requerido.' });
      const { data: agent } = await supabase.from('profiles').select('name').eq('id', agent_id).single();
      if (!agent) return res.status(404).json({ error: 'Agente no encontrado.' });
      return res.status(200).json({ success: true, agent_name: agent.name });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  try {
    const { agent_id, name, email, phone, interest, budget, message } = req.body;

    if (!agent_id) return res.status(400).json({ error: 'Agente no especificado.' });
    if (!name)     return res.status(400).json({ error: 'El nombre es requerido.' });
    if (!phone && !email) return res.status(400).json({ error: 'Teléfono o email requerido.' });

    // Verificar que el agente existe
    const { data: agent } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('id', agent_id)
      .single();
    if (!agent) return res.status(404).json({ error: 'Agente no encontrado.' });

    // ── Calificación IA ──
    const prompt = `Eres experto en bienes raíces para el mercado latino de USA. Analiza este lead y devuelve SOLO JSON válido sin texto adicional.

DATOS:
- Nombre: ${name}
- Email: ${email || 'No proporcionado'}
- Teléfono: ${phone || 'No proporcionado'}
- Propiedad de interés: ${interest || 'No especificado'}
- Presupuesto: ${budget || 'No especificado'}
- Mensaje: ${message || 'Sin mensaje'}

JSON requerido:
{
  "score": <1-10>,
  "level": "<Frío|Tibio|Caliente|Listo para cerrar>",
  "analysis": "<2-3 oraciones>",
  "steps": ["<acción 1>", "<acción 2>", "<acción 3>"],
  "email_subject": "<asunto>",
  "email_body": "<email 3-4 párrafos en español cálido y bicultural>"
}`;

    let ai = { score: 5, level: 'Tibio', analysis: 'Lead recibido vía formulario público.', steps: [], email_subject: 'Gracias por tu interés', email_body: '' };

    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1500,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const groqData = await groqRes.json();
      const clean = (groqData.choices?.[0]?.message?.content || '{}').replace(/```json|```/g, '').trim();
      ai = { ...ai, ...JSON.parse(clean) };
    } catch(e) { console.error('AI error:', e.message); }

    // ── Guardar ──
    const { error } = await supabase.from('leads').insert({
      agent_id,
      name,
      email:        email   || null,
      phone:        phone   || null,
      interest:     interest || null,
      budget:       budget  || null,
      message:      message || null,
      source:       'formulario',
      status:       'nuevo',
      score:        ai.score,
      level:        ai.level,
      ai_analysis:  ai.analysis,
      ai_steps:     JSON.stringify(ai.steps),
      ai_email_subject: ai.email_subject,
      ai_email_body:    ai.email_body,
      created_at:   new Date().toISOString()
    });
    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: '¡Gracias! El agente te contactará pronto.',
      agent_name: agent.name
    });

  } catch (err) {
    console.error('Error en /api/lead-form:', err);
    return res.status(500).json({ error: 'Error al enviar. Intenta de nuevo.' });
  }
};
