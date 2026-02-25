-- ============================================================
-- Production Financial OS (B2B) — Supabase Migrations
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- TABLA: projects
-- Proyectos vinculados a una organización
-- ============================================================
create table if not exists public.projects (
  id            uuid        not null default gen_random_uuid() primary key,
  organization_id uuid      not null references public.organizations(id) on delete cascade,
  name          text        not null,
  descripcion   text,
  moneda        text        not null default 'MXN',
  estado        text        not null default 'desarrollo',
  -- estados válidos: desarrollo | preproduccion | produccion | posproduccion | entrega
  fecha_inicio  date,
  fecha_fin     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- RLS
alter table public.projects enable row level security;

create policy "projects_select_org"
  on public.projects for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "projects_insert_org"
  on public.projects for insert
  with check (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "projects_update_org"
  on public.projects for update
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "projects_delete_org"
  on public.projects for delete
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

-- ============================================================
-- TABLA: expenses (gastos reales de producción)
-- ============================================================
create table if not exists public.expenses (
  id              uuid        not null default gen_random_uuid() primary key,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  project_id      uuid        not null references public.projects(id) on delete cascade,
  fecha           date        not null,
  cuenta          text        not null,   -- coincide con 'cuenta' del presupuesto
  concepto        text,                   -- descripción del gasto
  monto           numeric     not null check (monto > 0),
  proveedor       text,
  responsable     text,
  attachment_path text,                   -- ruta en Supabase Storage (opcional)
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now()
);

-- RLS
alter table public.expenses enable row level security;

create policy "expenses_select_org"
  on public.expenses for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "expenses_insert_org"
  on public.expenses for insert
  with check (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "expenses_update_org"
  on public.expenses for update
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "expenses_delete_org"
  on public.expenses for delete
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

-- ============================================================
-- TRIGGER: actualizar updated_at en projects automáticamente
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ============================================================
-- VERIFICACIÓN (opcional, puedes copiar y ejecutar esto aparte
-- para confirmar que las tablas se crearon bien):
-- select * from public.projects limit 5;
-- select * from public.expenses limit 5;
-- ============================================================
