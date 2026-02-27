# 🏠 PropIA — SaaS de IA para Agentes de Bienes Raíces Latinos

## Stack Tecnológico
- **Frontend:** HTML + CSS + JS vanilla (sin frameworks)
- **Backend:** Vercel Serverless Functions (Node.js)
- **Base de datos:** Supabase (PostgreSQL)
- **IA:** Groq API (LLaMA 3.1 — gratis)
- **Pagos:** Stripe (próximamente)

---

## Estructura del Proyecto

```
propia-saas/
├── index.html              → Landing + Login
├── dashboard.html          → App principal
├── api/
│   ├── generate.js         → Genera contenido con Groq (SEGURO)
│   ├── auth.js             → Login y registro con Supabase
│   └── usage.js            → Control de límites por plan
├── vercel.json             → Configuración de Vercel
├── package.json            → Dependencias
├── supabase-setup.sql      → Script para configurar la BD
├── .env.example            → Variables de entorno requeridas
└── .gitignore              → Protege archivos sensibles
```

---

## Pasos de Instalación

### PASO 1 — Configurar Supabase
1. Ve a tu proyecto en supabase.com
2. Dashboard → SQL Editor → New Query
3. Copia y pega el contenido de `supabase-setup.sql`
4. Click en "Run"
5. Guarda estos valores (Settings → API):
   - `Project URL`
   - `service_role` key (NO la anon key)

### PASO 2 — Subir a GitHub
1. Crea repositorio `propia-saas` en github.com
2. Sube todos los archivos
3. Asegúrate que `.env` NO está incluido (está en .gitignore)

### PASO 3 — Desplegar en Vercel
1. Ve a vercel.com → Add New Project
2. Importa el repositorio `propia-saas`
3. Antes de hacer Deploy, configura las variables de entorno:

   | Variable | Valor |
   |---|---|
   | `GROQ_API_KEY` | Tu key de console.groq.com |
   | `SUPABASE_URL` | URL de tu proyecto Supabase |
   | `SUPABASE_SERVICE_KEY` | service_role key de Supabase |

4. Click en Deploy

### PASO 4 — Habilitar Email Auth en Supabase
1. Supabase → Authentication → Providers
2. Asegúrate que "Email" está habilitado
3. Opcional: desactiva "Confirm email" para pruebas

---

## Variables de Entorno (Vercel Dashboard)

Estas variables van en: Vercel → Tu Proyecto → Settings → Environment Variables

```
GROQ_API_KEY=gsk_xxxx
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxxx
```

⚠️ NUNCA subas estas variables a GitHub.

---

## Módulos Actuales

| Módulo | Estado |
|---|---|
| ✅ Login / Registro | Listo |
| ✅ Generador de Listings | Listo |
| ✅ Control de uso por plan | Listo |
| ✅ Dashboard con historial | Listo |
| ✅ Planes Freemium | UI lista |
| 🔜 Calificador de Leads | Próximo |
| 🔜 Pagos con Stripe | Próximo |
| 🔜 Dashboard del Broker | Próximo |

---

## Planes Disponibles

| Plan | Precio | Listings/mes | Leads/mes |
|---|---|---|---|
| Gratis | $0 | 5 | 20 |
| Básico | $49/mes | 50 | 200 |
| Pro | $149/mes | 200 | 1,000 |
| Empresarial | $399/mes | Ilimitado | Ilimitado |

---

Hecho con ❤️ para la comunidad latina en USA
