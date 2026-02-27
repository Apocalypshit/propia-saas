// api/test.js — Archivo de diagnóstico
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    mensaje: 'Las API routes de Vercel funcionan correctamente',
    supabase_url: process.env.SUPABASE_URL ? '✅ Configurada' : '❌ NO configurada',
    supabase_key: process.env.SUPABASE_SERVICE_KEY ? '✅ Configurada' : '❌ NO configurada',
    groq_key: process.env.GROQ_API_KEY ? '✅ Configurada' : '❌ NO configurada',
    fecha: new Date().toISOString()
  });
};
