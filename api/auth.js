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

      // Usar anon key para signUp → Supabase envía el email via SMTP configurado (Resend)
      const anonClient = require('@supabase/supabase-js').createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );

      const { data, error } = await anonClient.auth.signUp({ email, password });

      console.log('[register] signUp user:', data?.user?.id || 'null');
      console.log('[register] signUp error:', error?.message || 'none');
      console.log('[register] email_confirmed_at:', data?.user?.email_confirmed_at || 'null — email sent');

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
        }
        return res.status(400).json({ error: error.message });
      }

      if (!data?.user) {
        return res.status(400).json({ error: 'No se pudo crear la cuenta. Intenta de nuevo.' });
      }

      // Crear perfil con service key (bypass RLS)
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
      else console.log('[register] Profile OK');

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
