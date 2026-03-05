// api/email.js — Notificaciones por email via Resend
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || 'PropIA <noreply@resend.dev>';
const APP_URL        = process.env.APP_URL    || 'https://propia-saas.vercel.app';

// ── Send email via Resend ─────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return { success: false, error: 'Email service not configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Resend error');
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Resend error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Email templates ───────────────────────────────────────────────
function templateNewLead({ agentName, leadName, leadPhone, leadEmail, leadInterest, leadBudget, leadScore, leadLevel, leadMessage, leadUrl }) {
  const scoreColor = leadScore >= 8 ? '#7c3aed' : leadScore >= 6 ? '#10b981' : leadScore >= 4 ? '#f59e0b' : '#6b7280';
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Nuevo Lead — PropIA</title></head>
<body style="margin:0;padding:0;background:#ede9fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ede9fb;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(124,58,237,.12);">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:28px 32px;">
    <div style="font-size:22px;font-weight:900;color:white;letter-spacing:-.5px;">🏠 PropIA</div>
    <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;">IA para Agentes Latinos en USA</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:32px;">
    <div style="font-size:20px;font-weight:800;color:#0f0a1e;margin-bottom:6px;">📥 Nuevo lead calificado</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:24px;">Hola ${agentName}, acaba de llegar un lead a tu pipeline.</div>

    <!-- Lead info -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6ff;border-radius:14px;padding:20px;margin-bottom:20px;">
      <tr><td>
        <div style="font-size:18px;font-weight:800;color:#0f0a1e;margin-bottom:4px;">${leadName}</div>
        ${leadPhone ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">📞 ${leadPhone}</div>` : ''}
        ${leadEmail ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">✉️ ${leadEmail}</div>` : ''}
        ${leadInterest ? `<div style="font-size:13px;color:#374151;margin-bottom:2px;">🏠 ${leadInterest}</div>` : ''}
        ${leadBudget ? `<div style="font-size:13px;color:#374151;">💰 ${leadBudget}</div>` : ''}
      </td></tr>
    </table>

    <!-- Score -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="background:#f8f6ff;border-radius:12px;padding:16px;text-align:center;width:50%;">
          <div style="font-size:36px;font-weight:900;color:${scoreColor};">${leadScore}<span style="font-size:16px;color:#9ca3af;">/10</span></div>
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Score IA</div>
        </td>
        <td width="12"></td>
        <td style="background:#f8f6ff;border-radius:12px;padding:16px;text-align:center;width:50%;">
          <div style="font-size:20px;font-weight:900;color:${scoreColor};">${leadLevel}</div>
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Calificación</div>
        </td>
      </tr>
    </table>

    ${leadMessage ? `
    <div style="background:#fff7ed;border:1.5px solid rgba(245,158,11,.25);border-radius:12px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Mensaje del lead</div>
      <div style="font-size:13px;color:#374151;line-height:1.7;">${leadMessage}</div>
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${leadUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;box-shadow:0 4px 16px rgba(124,58,237,.3);">
        Ver lead completo + Email IA →
      </a>
    </div>

    <div style="font-size:12px;color:#9ca3af;text-align:center;">
      ⚡ Recuerda: los leads se enfrían en menos de 5 minutos.<br/>Responde ahora para maximizar tu conversión.
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8f6ff;padding:20px 32px;text-align:center;border-top:1px solid rgba(124,58,237,.10);">
    <div style="font-size:12px;color:#9ca3af;">PropIA · <a href="${APP_URL}" style="color:#7c3aed;text-decoration:none;">propia-saas.vercel.app</a></div>
    <div style="font-size:11px;color:#d1d5db;margin-top:4px;">Para dejar de recibir notificaciones, ajusta tu configuración en el dashboard.</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  // Auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado.' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });

  const { type, leadId } = req.body;

  // ── Notify new lead ───────────────────────────────────────────
  if (type === 'new_lead') {
    try {
      // Get agent profile
      const { data: agent } = await supabase
        .from('profiles').select('name, email').eq('id', user.id).single();

      // Get lead data
      const { data: lead } = await supabase
        .from('leads').select('*').eq('id', leadId).eq('agent_id', user.id).single();

      if (!agent || !lead) return res.status(404).json({ error: 'Datos no encontrados.' });

      const html = templateNewLead({
        agentName:    agent.name || 'Agente',
        leadName:     lead.name,
        leadPhone:    lead.phone,
        leadEmail:    lead.email,
        leadInterest: lead.interest,
        leadBudget:   lead.budget,
        leadScore:    lead.score || 5,
        leadLevel:    lead.level || 'Tibio',
        leadMessage:  lead.message,
        leadUrl:      `${APP_URL}/dashboard`
      });

      const result = await sendEmail({
        to:      agent.email,
        subject: `📥 Nuevo lead: ${lead.name} · Score ${lead.score}/10`,
        html
      });

      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Tipo de email no reconocido.' });
};
