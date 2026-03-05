// api/leads.js — CRM de leads con calificación IA
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Inline email template for lead notifications ─────────────────
function buildLeadEmailHtml({ agentName, lead, ai, appUrl }) {
  const sc = lead.score || 5;
  const color = sc >= 8 ? '#7c3aed' : sc >= 6 ? '#10b981' : sc >= 4 ? '#f59e0b' : '#6b7280';
  return `<html><body style="margin:0;padding:24px;background:#ede9fb;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(124,58,237,.12);">
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px 28px;">
      <div style="font-size:20px;font-weight:900;color:white;">🏠 PropIA — Nuevo Lead</div>
      <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:3px;">Hola ${agentName}, tienes un lead nuevo esperándote.</div>
    </div>
    <div style="padding:28px;">
      <div style="background:#f8f6ff;border-radius:12px;padding:18px;margin-bottom:18px;">
        <div style="font-size:17px;font-weight:800;color:#0f0a1e;margin-bottom:6px;">${lead.name}</div>
        ${lead.phone  ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">📞 ${lead.phone}</div>` : ''}
        ${lead.email  ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">✉️ ${lead.email}</div>` : ''}
        ${lead.interest ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">🏠 ${lead.interest}</div>` : ''}
        ${lead.budget ? `<div style="font-size:13px;color:#374151;">💰 ${lead.budget}</div>` : ''}
      </div>
      <div style="display:flex;gap:12px;margin-bottom:18px;">
        <div style="flex:1;background:#f8f6ff;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:30px;font-weight:900;color:${color};">${sc}<span style="font-size:14px;color:#9ca3af;">/10</span></div>
          <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Score IA</div>
        </div>
        <div style="flex:1;background:#f8f6ff;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:18px;font-weight:900;color:${color};">${lead.level || 'Tibio'}</div>
          <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Nivel</div>
        </div>
      </div>
      ${ai?.analysis ? `<div style="background:#fff7ed;border:1.5px solid rgba(245,158,11,.25);border-radius:10px;padding:14px;margin-bottom:18px;font-size:13px;color:#374151;line-height:1.7;">${ai.analysis}</div>` : ''}
      <div style="text-align:center;">
        <a href="${appUrl}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;font-size:14px;font-weight:700;padding:13px 28px;border-radius:11px;text-decoration:none;">Ver lead en dashboard →</a>
      </div>
      <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">⚡ Responde en menos de 5 minutos para maximizar la conversión.</div>
    </div>
    <div style="background:#f8f6ff;padding:16px 28px;text-align:center;border-top:1px solid rgba(124,58,237,.10);">
      <div style="font-size:11px;color:#9ca3af;">PropIA · <a href="${appUrl}" style="color:#7c3aed;text-decoration:none;">propia-saas.vercel.app</a></div>
    </div>
  </div>
</body></html>`;
}


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

      // Fire email notification (non-blocking)
      try {
        const { data: agentProfile } = await supabase
          .from('profiles').select('email, name').eq('id', user.id).single();
        if (agentProfile?.email && process.env.RESEND_API_KEY) {
          const emailHtml = buildLeadEmailHtml({
            agentName: agentProfile.name || 'Agente',
            lead, ai,
            appUrl: process.env.APP_URL || 'https://propia-saas.vercel.app'
          });
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: process.env.FROM_EMAIL || 'PropIA <noreply@resend.dev>',
              to: [agentProfile.email],
              subject: `📥 Nuevo lead: ${lead.name} · Score ${lead.score}/10`,
              html: emailHtml
            })
          }).catch(e => console.error('Email error:', e.message));
        }
      } catch(e) { console.error('Email notify error:', e.message); }

      return res.status(200).json({ success: true, lead, ai });

    } catch (err) {
      console.error('Error en /api/leads:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido.' });
};
