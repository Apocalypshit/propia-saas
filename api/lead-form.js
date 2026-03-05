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

    // Notify agent by email (non-blocking)
    try {
      if (agent.email && process.env.RESEND_API_KEY) {
        const sc = ai.score || 5;
        const scColor = sc >= 8 ? '#7c3aed' : sc >= 6 ? '#10b981' : sc >= 4 ? '#f59e0b' : '#6b7280';
        const emailHtml = `<html><body style="margin:0;padding:24px;background:#ede9fb;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:18px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px 28px;">
    <div style="font-size:20px;font-weight:900;color:white;">🏠 PropIA — Lead desde tu formulario</div>
    <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:3px;">Hola ${agent.name || 'Agente'}, alguien llenó tu formulario público.</div>
  </div>
  <div style="padding:28px;">
    <div style="background:#f8f6ff;border-radius:12px;padding:18px;margin-bottom:18px;">
      <div style="font-size:17px;font-weight:800;color:#0f0a1e;margin-bottom:6px;">${name}</div>
      ${phone  ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">📞 ${phone}</div>` : ''}
      ${email  ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">✉️ ${email}</div>` : ''}
      ${interest ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">🏠 ${interest}</div>` : ''}
      ${budget ? `<div style="font-size:13px;color:#374151;">💰 ${budget}</div>` : ''}
    </div>
    <div style="display:flex;gap:12px;margin-bottom:18px;">
      <div style="flex:1;background:#f8f6ff;border-radius:10px;padding:14px;text-align:center;">
        <div style="font-size:30px;font-weight:900;color:${scColor};">${sc}<span style="font-size:14px;color:#9ca3af;">/10</span></div>
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Score IA</div>
      </div>
      <div style="flex:1;background:#f8f6ff;border-radius:10px;padding:14px;text-align:center;">
        <div style="font-size:18px;font-weight:900;color:${scColor};">${ai.level || 'Tibio'}</div>
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Nivel</div>
      </div>
    </div>
    <div style="text-align:center;">
      <a href="${process.env.APP_URL || 'https://propia-saas.vercel.app'}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;font-size:14px;font-weight:700;padding:13px 28px;border-radius:11px;text-decoration:none;">Ver en dashboard →</a>
    </div>
    <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">⚡ Responde en menos de 5 minutos para maximizar la conversión.</div>
  </div>
</div></body></html>`;
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.FROM_EMAIL || 'PropIA <onboarding@resend.dev>',
            to: [agent.email],
            subject: `📥 Nuevo lead desde tu formulario: ${name} · Score ${ai.score}/10`,
            html: emailHtml
          })
        }).catch(e => console.error('Email error:', e.message));
      }
    } catch(e) { console.error('Email notify error:', e.message); }

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
