-- ─────────────────────────────────────────────────────────
-- PropIA — Script de configuración de Supabase
-- Ejecuta esto en: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────

-- 1. TABLA DE PERFILES DE USUARIO
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  name text,
  brokerage text,
  plan text default 'free' check (plan in ('free','basic','pro','enterprise')),
  listings_used_this_month integer default 0,
  leads_used_this_month integer default 0,
  billing_period_start timestamptz default now(),
  created_at timestamptz default now()
);

-- 2. TABLA DE LISTINGS GENERADOS (historial)
create table if not exists public.listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  address text not null,
  price text,
  type text,
  tone text,
  content jsonb,
  created_at timestamptz default now()
);

-- 3. TABLA DE LEADS (para el módulo de calificación — próximamente)
create table if not exists public.leads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text,
  email text,
  phone text,
  status text default 'nuevo' check (status in ('nuevo','contactado','calificado','no_calificado','cerrado')),
  score integer default 0,
  notes text,
  source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. SEGURIDAD — Row Level Security (RLS)
-- Cada usuario solo ve SUS propios datos

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.leads enable row level security;

-- Políticas para profiles
create policy "Usuario puede ver su propio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Usuario puede actualizar su propio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Políticas para listings
create policy "Usuario ve sus propios listings"
  on public.listings for select
  using (auth.uid() = user_id);

create policy "Usuario crea sus propios listings"
  on public.listings for insert
  with check (auth.uid() = user_id);

-- Políticas para leads
create policy "Usuario ve sus propios leads"
  on public.leads for select
  using (auth.uid() = user_id);

create policy "Usuario crea sus propios leads"
  on public.leads for insert
  with check (auth.uid() = user_id);

create policy "Usuario actualiza sus propios leads"
  on public.leads for update
  using (auth.uid() = user_id);

-- 5. ÍNDICES para performance
create index if not exists idx_listings_user_id on public.listings(user_id);
create index if not exists idx_listings_created_at on public.listings(created_at desc);
create index if not exists idx_leads_user_id on public.leads(user_id);
create index if not exists idx_leads_status on public.leads(status);

-- ✅ Listo. Corre este script y tu base de datos estará configurada.
