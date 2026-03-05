// api/auth.js — Compatible con Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

// Service client — para operaciones admin (bypass RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Anon client — para auth pública (signUp, signIn) — dispara emails correctamente
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { action, email, password, name, brokerage, phone } = req.body;

  try {
    // REGISTRO
    if (action === 'register') {
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos.' });
      }

      // 1. Crear usuario (confirmado=false)
      const { data, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: false
      });

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
        }
        return res.status(400).json({ error: error.message });
      }
      if (!data?.user) return res.status(400).json({ error: 'No se pudo crear la cuenta.' });

      // 2. Crear perfil
      const profileData = {
        id: data.user.id, email, name,
        brokerage: brokerage || null,
        plan: 'free',
        listings_used_this_month: 0,
        leads_used_this_month: 0,
        billing_period_start: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
      const { error: profileError } = await supabase.from('profiles').insert(profileData);
      if (profileError) console.error('[register] Profile error:', profileError.message);

      // 3. Generar link de confirmación y enviarlo via Resend
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'signup',
        email,
        password
      });

      if (linkError) {
        console.error('[register] generateLink error:', linkError.message);
      } else {
        const confirmUrl = linkData?.properties?.action_link;
        if (confirmUrl && process.env.RESEND_API_KEY) {
          const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#ede9fb;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#ede9fb;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:white;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(124,58,237,.12);">
  <tr><td style="background:linear-gradient(135deg,#7c3aed,#4c1d95);padding:28px 32px;text-align:center;">
    <div style="font-size:26px;font-weight:900;color:white;letter-spacing:-1px;">🏠 PropIA</div>
    <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;">IA para Agentes Latinos en USA</div>
  </td></tr>
  <tr><td style="padding:36px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#0f0a1e;margin-bottom:10px;">Confirma tu cuenta</div>
    <div style="font-size:15px;color:#6b7280;margin-bottom:28px;line-height:1.6;">
      Hola <strong>${name}</strong>, haz clic en el botón para activar tu cuenta y empezar a generar listings con IA.
    </div>
    <a href="${confirmUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4c1d95);color:white;font-size:16px;font-weight:700;padding:16px 36px;border-radius:14px;text-decoration:none;box-shadow:0 4px 20px rgba(124,58,237,.35);">
      ✅ Confirmar mi cuenta
    </a>
    <div style="margin-top:24px;font-size:12px;color:#9ca3af;">
      O copia este enlace en tu navegador:<br/>
      <span style="color:#7c3aed;word-break:break-all;">${confirmUrl}</span>
    </div>
    <div style="margin-top:20px;font-size:11px;color:#d1d5db;">Este enlace expira en 24 horas.</div>
  </td></tr>
  <tr><td style="background:#f8f6ff;padding:18px 32px;text-align:center;border-top:1px solid rgba(124,58,237,.08);">
    <div style="font-size:11px;color:#9ca3af;">PropIA · propia-saas.vercel.app</div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: process.env.FROM_EMAIL || 'PropIA <noreply@resend.dev>',
              to: [email],
              subject: '✅ Confirma tu cuenta en PropIA',
              html
            })
          }).then(r => r.json()).then(d => {
            console.log('[register] Resend result:', d.id || d.message || JSON.stringify(d));
          }).catch(e => {
            console.error('[register] Resend error:', e.message);
          });
        } else {
          console.warn('[register] No confirmUrl or no RESEND_API_KEY');
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Cuenta creada. Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.'
      });
    }


    // LOGIN
    if (action === 'login') {
      if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
      }
      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

      // Block login if email not confirmed
      if (!data.user.email_confirmed_at) {
        return res.status(401).json({ error: 'Debes confirmar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.' });
      }

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single();

      return res.status(200).json({
        success: true,
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          name: profile?.name,
          brokerage: profile?.brokerage,
          plan: profile?.plan || 'free',
          listings_used: profile?.listings_used_this_month || 0
        }
      });
    }

    // PERFIL
    if (action === 'profile') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No autorizado.' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Sesión inválida.' });
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      return res.status(200).json({ success: true, user: { ...user, ...profile } });
    }

    // ACTUALIZAR PERFIL — nombre y brokerage
    if (action === 'updateProfile') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No autorizado.' });
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });
      const { name, brokerage } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido.' });
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ name: name.trim(), brokerage: (brokerage || '').trim() || null })
        .eq('id', user.id);
      if (updateErr) return res.status(400).json({ error: updateErr.message });
      return res.status(200).json({ success: true, name: name.trim(), brokerage: (brokerage || '').trim() || null });
    }

    // CAMBIAR CONTRASEÑA desde settings (usuario autenticado)
    if (action === 'changePassword') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No autorizado.' });
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: 'Sesión inválida.' });
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Todos los campos son requeridos.' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      // Verificar contraseña actual intentando iniciar sesión
      const { error: signInErr } = await supabaseAnon.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (signInErr) return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
      // Actualizar contraseña
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
      if (updateErr) return res.status(400).json({ error: updateErr.message });
      return res.status(200).json({ success: true, message: 'Contraseña actualizada.' });
    }

    // RECUPERAR CONTRASEÑA — paso 1: enviar email
    if (action === 'forgot') {
      if (!email) return res.status(400).json({ error: 'El correo electrónico es requerido.' });
      const { error } = await supabaseAnon.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://propia-saas.vercel.app/reset'
      });
      // Siempre responder con éxito para no revelar si el email existe
      if (error) console.error('resetPasswordForEmail error:', error.message);
      return res.status(200).json({
        success: true,
        message: 'Si ese correo existe en nuestro sistema, recibirás un enlace en minutos.'
      });
    }

    // RECUPERAR CONTRASEÑA — paso 2: establecer nueva contraseña con token
    if (action === 'reset') {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token y nueva contraseña son requeridos.' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      }
      // Verificar que el token sea válido
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return res.status(401).json({ error: 'El enlace expiró o no es válido. Solicita uno nuevo.' });
      }
      // Actualizar contraseña vía admin
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
        password: newPassword
      });
      if (updateErr) return res.status(400).json({ error: updateErr.message });
      return res.status(200).json({ success: true, message: 'Contraseña actualizada correctamente.' });
    }

    return res.status(400).json({ error: 'Acción no válida.' });

  } catch (err) {
    console.error('Error en /api/auth:', err);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
};
