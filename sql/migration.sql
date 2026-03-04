-- ============================================================
-- Production Financial OS — Suite Integral de Producción Audiovisual
-- migration.sql  (INCREMENTAL / SAFE — ejecutar en Supabase SQL Editor)
-- Fecha: 2026-03
-- ============================================================
-- NOTAS:
--   • Usa CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE — nunca borra existente.
--   • RLS habilitado en todas las tablas nuevas.
--   • Tablas existentes (projects, expenses, profiles, organizations,
--     project_state) NO se modifican ni se borran.
--   • Las policies se crean con DROP IF EXISTS + CREATE para ser idempotentes.
-- ============================================================

-- ============================================================
-- 0. EXTENSIÓN
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
-- 1. project_state (tabla existente — garantizamos que exista)
-- ============================================================
create table if not exists public.project_state (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  project_id  uuid        not null references public.projects(id) on delete cascade,
  module_key  text        not null,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(user_id, project_id, module_key)
);

alter table public.project_state enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='project_state' and policyname='project_state_own'
  ) then
    execute $pol$
      create policy "project_state_own" on public.project_state
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
    $pol$;
  end if;
end $$;

-- ============================================================
-- 2. FUNCIÓN AUDIT — set_audit_fields()
--    Se aplica como trigger BEFORE INSERT OR UPDATE en tablas nuevas.
-- ============================================================
create or replace function public.set_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at  := coalesce(new.created_at, now());
    new.updated_at  := now();
    new.created_by  := coalesce(new.created_by, auth.uid());
    new.updated_by  := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_at  := now();
    new.updated_by  := auth.uid();
    -- Protect created_* from accidental mutation
    new.created_at  := old.created_at;
    new.created_by  := old.created_by;
  end if;
  return new;
end;
$$;

-- ============================================================
-- 3. project_members
-- ============================================================
create table if not exists public.project_members (
  id          uuid not null default gen_random_uuid() primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','producer','accounting','post','crew_viewer','runner')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique(project_id, user_id)
);

drop trigger if exists project_members_audit on public.project_members;
create trigger project_members_audit
  before insert or update on public.project_members
  for each row execute function public.set_audit_fields();

alter table public.project_members enable row level security;

-- ============================================================
-- 4. HELPER FUNCTIONS — is_project_member / has_project_role
-- ============================================================

-- is_project_member: true si el usuario pertenece a la misma org que el proyecto
-- (acceso read implícito para todos los org-members) O está explícitamente en project_members.
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    -- Org-level membership (preserva comportamiento existente)
    exists (
      select 1
      from public.projects pr
      join public.profiles pf on pf.organization_id = pr.organization_id
      where pr.id = p_project_id
        and pf.id = auth.uid()
    )
    or
    -- Explicit project membership
    exists (
      select 1
      from public.project_members
      where project_id = p_project_id
        and user_id = auth.uid()
    )
  );
$$;

-- has_project_role: true si tiene rol explícito en project_members
-- O si es admin de org (profiles.role = 'admin').
create or replace function public.has_project_role(p_project_id uuid, p_role text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    exists (
      select 1
      from public.project_members
      where project_id = p_project_id
        and user_id = auth.uid()
        and role = p_role
    )
    or
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'admin'
    )
  );
$$;

-- ============================================================
-- 5. TABLA: locations
-- ============================================================
create table if not exists public.locations (
  id              uuid not null default gen_random_uuid() primary key,
  project_id      uuid not null references public.projects(id) on delete cascade,
  name            text not null,
  address         text,
  contact_name    text,
  contact_phone   text,
  restrictions    text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

drop trigger if exists locations_audit on public.locations;
create trigger locations_audit
  before insert or update on public.locations
  for each row execute function public.set_audit_fields();

alter table public.locations enable row level security;

-- ============================================================
-- 6. TABLA: schedule_days
-- ============================================================
create table if not exists public.schedule_days (
  id                   uuid not null default gen_random_uuid() primary key,
  project_id           uuid not null references public.projects(id) on delete cascade,
  shoot_date           date not null,
  unit                 text not null default 'A' check (unit in ('A','B','C')),
  primary_location_id  uuid references public.locations(id) on delete set null,
  call_time            time,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  unique(project_id, shoot_date, unit)
);

drop trigger if exists schedule_days_audit on public.schedule_days;
create trigger schedule_days_audit
  before insert or update on public.schedule_days
  for each row execute function public.set_audit_fields();

alter table public.schedule_days enable row level security;

-- ============================================================
-- 7. TABLA: scenes
-- ============================================================
create table if not exists public.scenes (
  id          uuid not null default gen_random_uuid() primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null,
  pages       text,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique(project_id, code)
);

drop trigger if exists scenes_audit on public.scenes;
create trigger scenes_audit
  before insert or update on public.scenes
  for each row execute function public.set_audit_fields();

alter table public.scenes enable row level security;

-- ============================================================
-- 8. TABLA: schedule_day_scenes
-- ============================================================
create table if not exists public.schedule_day_scenes (
  id               uuid not null default gen_random_uuid() primary key,
  schedule_day_id  uuid not null references public.schedule_days(id) on delete cascade,
  scene_id         uuid not null references public.scenes(id) on delete restrict,
  order_index      int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique(schedule_day_id, scene_id)
);

drop trigger if exists schedule_day_scenes_audit on public.schedule_day_scenes;
create trigger schedule_day_scenes_audit
  before insert or update on public.schedule_day_scenes
  for each row execute function public.set_audit_fields();

alter table public.schedule_day_scenes enable row level security;

-- ============================================================
-- 9. TABLA: crew
-- ============================================================
create table if not exists public.crew (
  id          uuid not null default gen_random_uuid() primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  role_name   text not null,
  rate        numeric(12,2),
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);

drop trigger if exists crew_audit on public.crew;
create trigger crew_audit
  before insert or update on public.crew
  for each row execute function public.set_audit_fields();

alter table public.crew enable row level security;

-- ============================================================
-- 10. TABLA: crew_assignments
-- ============================================================
create table if not exists public.crew_assignments (
  id               uuid not null default gen_random_uuid() primary key,
  project_id       uuid not null references public.projects(id) on delete cascade,
  schedule_day_id  uuid not null references public.schedule_days(id) on delete cascade,
  crew_id          uuid not null references public.crew(id) on delete cascade,
  call_time        time,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique(schedule_day_id, crew_id)
);

drop trigger if exists crew_assignments_audit on public.crew_assignments;
create trigger crew_assignments_audit
  before insert or update on public.crew_assignments
  for each row execute function public.set_audit_fields();

alter table public.crew_assignments enable row level security;

-- ============================================================
-- 11. TABLA: gear_items
-- ============================================================
create table if not exists public.gear_items (
  id            uuid not null default gen_random_uuid() primary key,
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  type          text,
  owner_type    text not null default 'owned' check (owner_type in ('owned','rented')),
  vendor        text,
  cost_per_day  numeric(12,2),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid
);

drop trigger if exists gear_items_audit on public.gear_items;
create trigger gear_items_audit
  before insert or update on public.gear_items
  for each row execute function public.set_audit_fields();

alter table public.gear_items enable row level security;

-- ============================================================
-- 12. TABLA: gear_reservations
-- ============================================================
create table if not exists public.gear_reservations (
  id               uuid not null default gen_random_uuid() primary key,
  project_id       uuid not null references public.projects(id) on delete cascade,
  gear_item_id     uuid not null references public.gear_items(id) on delete cascade,
  schedule_day_id  uuid not null references public.schedule_days(id) on delete cascade,
  quantity         int  not null default 1 check (quantity > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique(gear_item_id, schedule_day_id)
);

drop trigger if exists gear_reservations_audit on public.gear_reservations;
create trigger gear_reservations_audit
  before insert or update on public.gear_reservations
  for each row execute function public.set_audit_fields();

alter table public.gear_reservations enable row level security;

-- ============================================================
-- 13. TABLA: call_sheets
-- ============================================================
create table if not exists public.call_sheets (
  id               uuid not null default gen_random_uuid() primary key,
  project_id       uuid not null references public.projects(id) on delete cascade,
  schedule_day_id  uuid not null references public.schedule_days(id) on delete cascade,
  status           text not null default 'draft' check (status in ('draft','review','published')),
  current_version  int  not null default 0 check (current_version >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid
);

drop trigger if exists call_sheets_audit on public.call_sheets;
create trigger call_sheets_audit
  before insert or update on public.call_sheets
  for each row execute function public.set_audit_fields();

alter table public.call_sheets enable row level security;

-- ============================================================
-- 14. TABLA: call_sheet_versions (snapshots inmutables)
-- ============================================================
create table if not exists public.call_sheet_versions (
  id               uuid not null default gen_random_uuid() primary key,
  call_sheet_id    uuid not null references public.call_sheets(id) on delete cascade,
  version_number   int  not null check (version_number > 0),
  snapshot         jsonb not null,
  published_at     timestamptz,
  published_by     uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique(call_sheet_id, version_number)
);

drop trigger if exists call_sheet_versions_audit on public.call_sheet_versions;
create trigger call_sheet_versions_audit
  before insert or update on public.call_sheet_versions
  for each row execute function public.set_audit_fields();

alter table public.call_sheet_versions enable row level security;

-- ============================================================
-- 15. TABLA: daily_reports (DPR)
-- ============================================================
create table if not exists public.daily_reports (
  id               uuid not null default gen_random_uuid() primary key,
  project_id       uuid not null references public.projects(id) on delete cascade,
  schedule_day_id  uuid not null references public.schedule_days(id) on delete cascade,
  content          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique(project_id, schedule_day_id)
);

drop trigger if exists daily_reports_audit on public.daily_reports;
create trigger daily_reports_audit
  before insert or update on public.daily_reports
  for each row execute function public.set_audit_fields();

alter table public.daily_reports enable row level security;

-- ============================================================
-- 16. TABLA: purchase_requests (PR)
-- ============================================================
create table if not exists public.purchase_requests (
  id            uuid not null default gen_random_uuid() primary key,
  project_id    uuid not null references public.projects(id) on delete cascade,
  requested_by  uuid not null default auth.uid(),
  status        text not null default 'draft'
                  check (status in ('draft','submitted','approved','rejected','cancelled')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid
);

drop trigger if exists purchase_requests_audit on public.purchase_requests;
create trigger purchase_requests_audit
  before insert or update on public.purchase_requests
  for each row execute function public.set_audit_fields();

alter table public.purchase_requests enable row level security;

-- ============================================================
-- 17. TABLA: purchase_orders (PO)
-- ============================================================
create table if not exists public.purchase_orders (
  id                  uuid not null default gen_random_uuid() primary key,
  project_id          uuid not null references public.projects(id) on delete cascade,
  pr_id               uuid references public.purchase_requests(id) on delete set null,
  po_number           text not null,
  status              text not null default 'draft'
                        check (status in ('draft','approved','issued','received','invoiced','paid','cancelled')),
  vendor              text,
  subtotal            numeric(12,2) not null default 0,
  tax                 numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  linked_expense_id   uuid,      -- FK a expenses.id si la tabla existe
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  unique(project_id, po_number)
);

drop trigger if exists purchase_orders_audit on public.purchase_orders;
create trigger purchase_orders_audit
  before insert or update on public.purchase_orders
  for each row execute function public.set_audit_fields();

alter table public.purchase_orders enable row level security;

-- ============================================================
-- 18. TABLA: po_lines
-- ============================================================
create table if not exists public.po_lines (
  id           uuid not null default gen_random_uuid() primary key,
  po_id        uuid not null references public.purchase_orders(id) on delete cascade,
  description  text not null,
  qty          numeric(12,2) not null default 1 check (qty > 0),
  unit_cost    numeric(12,2) not null default 0 check (unit_cost >= 0),
  line_total   numeric(12,2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid
);

drop trigger if exists po_lines_audit on public.po_lines;
create trigger po_lines_audit
  before insert or update on public.po_lines
  for each row execute function public.set_audit_fields();

alter table public.po_lines enable row level security;

-- Trigger: recalcular line_total y totals del PO al insertar/actualizar/borrar líneas
create or replace function public.recalc_po_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_subtotal numeric(12,2);
begin
  -- Determinar cuál PO afectar
  if tg_op = 'DELETE' then
    v_po_id := old.po_id;
  else
    -- Recalcular line_total en la fila actual
    new.line_total := round(new.qty * new.unit_cost, 2);
    v_po_id := new.po_id;
  end if;

  -- Si es INSERT/UPDATE recalculamos DESPUÉS de que la fila quede guardada.
  -- Usamos un FOR EACH ROW AFTER trigger para el recalc del PO.
  return new;
end;
$$;

-- Trigger BEFORE para recalcular line_total en la línea
drop trigger if exists po_lines_calc_line on public.po_lines;
create trigger po_lines_calc_line
  before insert or update on public.po_lines
  for each row execute function public.recalc_po_totals();

-- Función AFTER para actualizar totales del PO padre
create or replace function public.recalc_po_parent_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_subtotal numeric(12,2);
begin
  if tg_op = 'DELETE' then
    v_po_id := old.po_id;
  else
    v_po_id := new.po_id;
  end if;

  select coalesce(sum(line_total), 0)
    into v_subtotal
    from public.po_lines
   where po_id = v_po_id;

  update public.purchase_orders
     set subtotal   = v_subtotal,
         -- tax asumido 16% sobre subtotal; el frontend puede sobreescribir si necesita lógica distinta
         tax        = round(v_subtotal * 0.16, 2),
         total      = v_subtotal + round(v_subtotal * 0.16, 2),
         updated_at = now()
   where id = v_po_id;

  return null;  -- AFTER trigger no retorna fila
end;
$$;

drop trigger if exists po_lines_update_po_totals on public.po_lines;
create trigger po_lines_update_po_totals
  after insert or update or delete on public.po_lines
  for each row execute function public.recalc_po_parent_totals();

-- ============================================================
-- 19. TABLA: deliverables
-- ============================================================
create table if not exists public.deliverables (
  id          uuid not null default gen_random_uuid() primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  specs       jsonb not null default '{}'::jsonb,
  status      text not null default 'in_progress'
                check (status in ('todo','in_progress','needs_review','approved','delivered')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);

drop trigger if exists deliverables_audit on public.deliverables;
create trigger deliverables_audit
  before insert or update on public.deliverables
  for each row execute function public.set_audit_fields();

alter table public.deliverables enable row level security;

-- ============================================================
-- 20. TABLA: deliverable_stages
-- ============================================================
create table if not exists public.deliverable_stages (
  id              uuid not null default gen_random_uuid() primary key,
  deliverable_id  uuid not null references public.deliverables(id) on delete cascade,
  stage_name      text not null
                    check (stage_name in ('edit','color','audio','vfx','qc','final')),
  order_index     int  not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  unique(deliverable_id, stage_name)
);

drop trigger if exists deliverable_stages_audit on public.deliverable_stages;
create trigger deliverable_stages_audit
  before insert or update on public.deliverable_stages
  for each row execute function public.set_audit_fields();

alter table public.deliverable_stages enable row level security;

-- ============================================================
-- 21. TABLA: deliverable_stage_items (Kanban)
-- ============================================================
create table if not exists public.deliverable_stage_items (
  id              uuid not null default gen_random_uuid() primary key,
  deliverable_id  uuid not null references public.deliverables(id) on delete cascade,
  stage_name      text not null
                    check (stage_name in ('edit','color','audio','vfx','qc','final')),
  title           text not null,
  description     text,
  status          text not null default 'todo'
                    check (status in ('todo','doing','done')),
  order_index     int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

drop trigger if exists deliverable_stage_items_audit on public.deliverable_stage_items;
create trigger deliverable_stage_items_audit
  before insert or update on public.deliverable_stage_items
  for each row execute function public.set_audit_fields();

alter table public.deliverable_stage_items enable row level security;

-- ============================================================
-- 22. TABLA: documents (maestros)
-- ============================================================
create table if not exists public.documents (
  id                  uuid not null default gen_random_uuid() primary key,
  project_id          uuid not null references public.projects(id) on delete cascade,
  type                text not null
                        check (type in ('script','budget','schedule','call_sheet','release',
                                        'insurance','contract','guide','other')),
  title               text not null,
  current_version_id  uuid,   -- FK se agrega después de document_versions
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid
);

drop trigger if exists documents_audit on public.documents;
create trigger documents_audit
  before insert or update on public.documents
  for each row execute function public.set_audit_fields();

alter table public.documents enable row level security;

-- ============================================================
-- 23. TABLA: document_versions
-- ============================================================
create table if not exists public.document_versions (
  id              uuid not null default gen_random_uuid() primary key,
  document_id     uuid not null references public.documents(id) on delete cascade,
  version_number  int  not null check (version_number > 0),
  storage_bucket  text not null,
  storage_path    text not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  unique(document_id, version_number)
);

drop trigger if exists document_versions_audit on public.document_versions;
create trigger document_versions_audit
  before insert or update on public.document_versions
  for each row execute function public.set_audit_fields();

alter table public.document_versions enable row level security;

-- Ahora añadimos FK de documents.current_version_id → document_versions.id
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_current_version_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_current_version_id_fkey
      foreign key (current_version_id)
      references public.document_versions(id)
      on delete set null;
  end if;
end $$;

-- ============================================================
-- 24. TABLA: attachments (transversal)
-- ============================================================
create table if not exists public.attachments (
  id              uuid not null default gen_random_uuid() primary key,
  project_id      uuid not null references public.projects(id) on delete cascade,
  module          text not null,   -- 'expenses','call_sheets','documents','purchase_orders','daily_reports'
  entity_id       uuid not null,
  storage_bucket  text not null,
  storage_path    text not null,
  mime_type       text,
  size_bytes      bigint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

create index if not exists attachments_lookup_idx
  on public.attachments(project_id, module, entity_id);

drop trigger if exists attachments_audit on public.attachments;
create trigger attachments_audit
  before insert or update on public.attachments
  for each row execute function public.set_audit_fields();

alter table public.attachments enable row level security;

-- ============================================================
-- 25. audit_log
-- ============================================================
create table if not exists public.audit_log (
  id          uuid not null default gen_random_uuid() primary key,
  project_id  uuid,
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now(),
  diff        jsonb
);

alter table public.audit_log enable row level security;

-- Solo producers/admins pueden leer audit_log; nadie puede escribir desde cliente
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='audit_log' and policyname='audit_log_select'
  ) then
    execute $pol$
      create policy "audit_log_select" on public.audit_log
      for select using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'admin'
        )
        or public.has_project_role(project_id, 'producer')
        or public.has_project_role(project_id, 'admin')
      )
    $pol$;
  end if;
end $$;

-- Función genérica para audit log
create or replace function public.log_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_record_id  uuid;
  v_diff       jsonb;
begin
  -- Intentar obtener project_id del registro
  begin
    if tg_op = 'DELETE' then
      v_record_id  := old.id;
      v_project_id := (to_jsonb(old) ->> 'project_id')::uuid;
      v_diff       := jsonb_build_object('old', to_jsonb(old));
    elsif tg_op = 'INSERT' then
      v_record_id  := new.id;
      v_project_id := (to_jsonb(new) ->> 'project_id')::uuid;
      v_diff       := jsonb_build_object('new', to_jsonb(new));
    else -- UPDATE
      v_record_id  := new.id;
      v_project_id := (to_jsonb(new) ->> 'project_id')::uuid;
      v_diff       := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    end if;
  exception when others then
    v_project_id := null;
  end;

  insert into public.audit_log(project_id, table_name, record_id, action, changed_by, diff)
  values (v_project_id, tg_table_name, v_record_id, tg_op, auth.uid(), v_diff);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Aplicar audit log a tablas sensibles
do $$ begin

  if not exists (select 1 from pg_trigger where tgname='purchase_requests_log') then
    create trigger purchase_requests_log
      after insert or update or delete on public.purchase_requests
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='purchase_orders_log') then
    create trigger purchase_orders_log
      after insert or update or delete on public.purchase_orders
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='po_lines_log') then
    create trigger po_lines_log
      after insert or update or delete on public.po_lines
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='call_sheets_log') then
    create trigger call_sheets_log
      after insert or update or delete on public.call_sheets
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='call_sheet_versions_log') then
    create trigger call_sheet_versions_log
      after insert or update or delete on public.call_sheet_versions
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='deliverables_log') then
    create trigger deliverables_log
      after insert or update or delete on public.deliverables
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='documents_log') then
    create trigger documents_log
      after insert or update or delete on public.documents
      for each row execute function public.log_changes();
  end if;

  if not exists (select 1 from pg_trigger where tgname='document_versions_log') then
    create trigger document_versions_log
      after insert or update or delete on public.document_versions
      for each row execute function public.log_changes();
  end if;

end $$;

-- ============================================================
-- 26. RPC: publish_call_sheet
-- ============================================================
create or replace function public.publish_call_sheet(p_call_sheet_id uuid)
returns table(version_number int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cs            record;
  v_day           record;
  v_new_version   int;
  v_snapshot      jsonb;
  v_location      jsonb;
  v_crew_list     jsonb;
  v_scenes_list   jsonb;
begin
  -- 1. Lock row
  select * into v_cs
    from public.call_sheets
   where id = p_call_sheet_id
     for update;

  if not found then
    raise exception 'call_sheet not found: %', p_call_sheet_id;
  end if;

  -- Verificar que el usuario tiene acceso (producer o admin)
  if not (
    public.has_project_role(v_cs.project_id, 'producer')
    or public.has_project_role(v_cs.project_id, 'admin')
  ) then
    raise exception 'Sin permisos para publicar este call sheet';
  end if;

  -- 2. Obtener datos del día de rodaje
  select sd.*, l.name as location_name, l.address as location_address
    into v_day
    from public.schedule_days sd
    left join public.locations l on l.id = sd.primary_location_id
   where sd.id = v_cs.schedule_day_id;

  -- 3. Construir location jsonb
  v_location := jsonb_build_object(
    'id',      v_day.primary_location_id,
    'name',    v_day.location_name,
    'address', v_day.location_address
  );

  -- 4. Crew assignments del día
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'crew_id',   ca.crew_id,
      'name',      c.name,
      'role_name', c.role_name,
      'phone',     c.phone,
      'call_time', ca.call_time
    ) order by c.role_name, c.name
  ), '[]'::jsonb)
  into v_crew_list
  from public.crew_assignments ca
  join public.crew c on c.id = ca.crew_id
  where ca.schedule_day_id = v_cs.schedule_day_id;

  -- 5. Escenas del día ordenadas
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'scene_id',    s.id,
      'code',        s.code,
      'pages',       s.pages,
      'description', s.description,
      'order_index', sds.order_index
    ) order by sds.order_index
  ), '[]'::jsonb)
  into v_scenes_list
  from public.schedule_day_scenes sds
  join public.scenes s on s.id = sds.scene_id
  where sds.schedule_day_id = v_cs.schedule_day_id;

  -- 6. Construir snapshot completo
  v_snapshot := jsonb_build_object(
    'header', jsonb_build_object(
      'project_id',      v_cs.project_id,
      'schedule_day_id', v_cs.schedule_day_id,
      'unit',            v_day.unit,
      'shoot_date',      v_day.shoot_date,
      'call_time',       v_day.call_time,
      'notes',           v_day.notes
    ),
    'location', v_location,
    'crew',     v_crew_list,
    'scenes',   v_scenes_list,
    'published_at', now()
  );

  -- 7. Nueva versión = current_version + 1
  v_new_version := v_cs.current_version + 1;

  -- 8. Insertar versión inmutable
  insert into public.call_sheet_versions
    (call_sheet_id, version_number, snapshot, published_at, published_by)
  values
    (p_call_sheet_id, v_new_version, v_snapshot, now(), auth.uid());

  -- 9. Actualizar call_sheet
  update public.call_sheets
     set status          = 'published',
         current_version = v_new_version,
         updated_at      = now(),
         updated_by      = auth.uid()
   where id = p_call_sheet_id;

  -- 10. Retornar
  return query select v_new_version;
end;
$$;

-- ============================================================
-- 27. RLS POLICIES — todas las tablas nuevas
-- ============================================================

-- Helper: eliminar y recrear policies (idempotente)
do $$ begin

  -- ─────────────────────────────────
  -- project_members
  -- ─────────────────────────────────
  drop policy if exists "pm_select" on public.project_members;
  drop policy if exists "pm_insert" on public.project_members;
  drop policy if exists "pm_update" on public.project_members;
  drop policy if exists "pm_delete" on public.project_members;

  create policy "pm_select" on public.project_members
    for select using (public.is_project_member(project_id));

  create policy "pm_insert" on public.project_members
    for insert with check (
      public.has_project_role(project_id, 'admin')
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    );

  create policy "pm_update" on public.project_members
    for update using (
      public.has_project_role(project_id, 'admin')
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    );

  create policy "pm_delete" on public.project_members
    for delete using (
      public.has_project_role(project_id, 'admin')
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    );

  -- ─────────────────────────────────
  -- locations
  -- ─────────────────────────────────
  drop policy if exists "locations_select" on public.locations;
  drop policy if exists "locations_write"  on public.locations;

  create policy "locations_select" on public.locations
    for select using (public.is_project_member(project_id));

  create policy "locations_write" on public.locations
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- schedule_days
  -- ─────────────────────────────────
  drop policy if exists "schedule_days_select" on public.schedule_days;
  drop policy if exists "schedule_days_write"  on public.schedule_days;

  create policy "schedule_days_select" on public.schedule_days
    for select using (public.is_project_member(project_id));

  create policy "schedule_days_write" on public.schedule_days
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- scenes
  -- ─────────────────────────────────
  drop policy if exists "scenes_select" on public.scenes;
  drop policy if exists "scenes_write"  on public.scenes;

  create policy "scenes_select" on public.scenes
    for select using (public.is_project_member(project_id));

  create policy "scenes_write" on public.scenes
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- schedule_day_scenes (acceso via schedule_day → project)
  -- ─────────────────────────────────
  drop policy if exists "sds_select" on public.schedule_day_scenes;
  drop policy if exists "sds_write"  on public.schedule_day_scenes;

  create policy "sds_select" on public.schedule_day_scenes
    for select using (
      exists (
        select 1 from public.schedule_days sd
        where sd.id = schedule_day_id
          and public.is_project_member(sd.project_id)
      )
    );

  create policy "sds_write" on public.schedule_day_scenes
    for all using (
      exists (
        select 1 from public.schedule_days sd
        where sd.id = schedule_day_id
          and (
            public.has_project_role(sd.project_id, 'producer')
            or public.has_project_role(sd.project_id, 'admin')
          )
      )
    ) with check (
      exists (
        select 1 from public.schedule_days sd
        where sd.id = schedule_day_id
          and (
            public.has_project_role(sd.project_id, 'producer')
            or public.has_project_role(sd.project_id, 'admin')
          )
      )
    );

  -- ─────────────────────────────────
  -- crew
  -- ─────────────────────────────────
  drop policy if exists "crew_select" on public.crew;
  drop policy if exists "crew_write"  on public.crew;

  create policy "crew_select" on public.crew
    for select using (public.is_project_member(project_id));

  create policy "crew_write" on public.crew
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- crew_assignments
  -- ─────────────────────────────────
  drop policy if exists "crew_asgn_select" on public.crew_assignments;
  drop policy if exists "crew_asgn_write"  on public.crew_assignments;

  create policy "crew_asgn_select" on public.crew_assignments
    for select using (public.is_project_member(project_id));

  create policy "crew_asgn_write" on public.crew_assignments
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- gear_items
  -- ─────────────────────────────────
  drop policy if exists "gear_items_select" on public.gear_items;
  drop policy if exists "gear_items_write"  on public.gear_items;

  create policy "gear_items_select" on public.gear_items
    for select using (public.is_project_member(project_id));

  create policy "gear_items_write" on public.gear_items
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- gear_reservations
  -- ─────────────────────────────────
  drop policy if exists "gear_res_select" on public.gear_reservations;
  drop policy if exists "gear_res_write"  on public.gear_reservations;

  create policy "gear_res_select" on public.gear_reservations
    for select using (public.is_project_member(project_id));

  create policy "gear_res_write" on public.gear_reservations
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- call_sheets
  -- ─────────────────────────────────
  drop policy if exists "cs_select" on public.call_sheets;
  drop policy if exists "cs_write"  on public.call_sheets;

  create policy "cs_select" on public.call_sheets
    for select using (public.is_project_member(project_id));

  create policy "cs_write" on public.call_sheets
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- call_sheet_versions
  -- ─────────────────────────────────
  drop policy if exists "csv_select" on public.call_sheet_versions;
  drop policy if exists "csv_write"  on public.call_sheet_versions;

  create policy "csv_select" on public.call_sheet_versions
    for select using (
      exists (
        select 1 from public.call_sheets cs
        where cs.id = call_sheet_id
          and public.is_project_member(cs.project_id)
      )
    );

  -- Solo service-role (RPC) puede insertar versiones; no directo desde cliente
  create policy "csv_write" on public.call_sheet_versions
    for all using (false)
    with check (false);

  -- ─────────────────────────────────
  -- daily_reports
  -- ─────────────────────────────────
  drop policy if exists "dr_select" on public.daily_reports;
  drop policy if exists "dr_write"  on public.daily_reports;

  create policy "dr_select" on public.daily_reports
    for select using (public.is_project_member(project_id));

  create policy "dr_write" on public.daily_reports
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- purchase_requests
  -- ─────────────────────────────────
  drop policy if exists "pr_select" on public.purchase_requests;
  drop policy if exists "pr_write"  on public.purchase_requests;

  create policy "pr_select" on public.purchase_requests
    for select using (public.is_project_member(project_id));

  create policy "pr_write" on public.purchase_requests
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'accounting')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'accounting')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- purchase_orders
  -- ─────────────────────────────────
  drop policy if exists "po_select" on public.purchase_orders;
  drop policy if exists "po_write"  on public.purchase_orders;

  create policy "po_select" on public.purchase_orders
    for select using (public.is_project_member(project_id));

  create policy "po_write" on public.purchase_orders
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'accounting')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'accounting')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- po_lines (acceso via PO → project)
  -- ─────────────────────────────────
  drop policy if exists "pol_select" on public.po_lines;
  drop policy if exists "pol_write"  on public.po_lines;

  create policy "pol_select" on public.po_lines
    for select using (
      exists (
        select 1 from public.purchase_orders po
        where po.id = po_id
          and public.is_project_member(po.project_id)
      )
    );

  create policy "pol_write" on public.po_lines
    for all using (
      exists (
        select 1 from public.purchase_orders po
        where po.id = po_id
          and (
            public.has_project_role(po.project_id, 'producer')
            or public.has_project_role(po.project_id, 'accounting')
            or public.has_project_role(po.project_id, 'admin')
          )
      )
    ) with check (
      exists (
        select 1 from public.purchase_orders po
        where po.id = po_id
          and (
            public.has_project_role(po.project_id, 'producer')
            or public.has_project_role(po.project_id, 'accounting')
            or public.has_project_role(po.project_id, 'admin')
          )
      )
    );

  -- ─────────────────────────────────
  -- deliverables
  -- ─────────────────────────────────
  drop policy if exists "deliv_select" on public.deliverables;
  drop policy if exists "deliv_write"  on public.deliverables;

  create policy "deliv_select" on public.deliverables
    for select using (public.is_project_member(project_id));

  create policy "deliv_write" on public.deliverables
    for all using (
      public.has_project_role(project_id, 'post')
      or public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'post')
      or public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- deliverable_stages (via deliverable → project)
  -- ─────────────────────────────────
  drop policy if exists "ds_select" on public.deliverable_stages;
  drop policy if exists "ds_write"  on public.deliverable_stages;

  create policy "ds_select" on public.deliverable_stages
    for select using (
      exists (
        select 1 from public.deliverables d
        where d.id = deliverable_id
          and public.is_project_member(d.project_id)
      )
    );

  create policy "ds_write" on public.deliverable_stages
    for all using (
      exists (
        select 1 from public.deliverables d
        where d.id = deliverable_id
          and (
            public.has_project_role(d.project_id, 'post')
            or public.has_project_role(d.project_id, 'producer')
            or public.has_project_role(d.project_id, 'admin')
          )
      )
    ) with check (
      exists (
        select 1 from public.deliverables d
        where d.id = deliverable_id
          and (
            public.has_project_role(d.project_id, 'post')
            or public.has_project_role(d.project_id, 'producer')
            or public.has_project_role(d.project_id, 'admin')
          )
      )
    );

  -- ─────────────────────────────────
  -- deliverable_stage_items (via deliverable → project)
  -- ─────────────────────────────────
  drop policy if exists "dsi_select" on public.deliverable_stage_items;
  drop policy if exists "dsi_write"  on public.deliverable_stage_items;

  create policy "dsi_select" on public.deliverable_stage_items
    for select using (
      exists (
        select 1 from public.deliverables d
        where d.id = deliverable_id
          and public.is_project_member(d.project_id)
      )
    );

  create policy "dsi_write" on public.deliverable_stage_items
    for all using (
      exists (
        select 1 from public.deliverables d
        where d.id = deliverable_id
          and (
            public.has_project_role(d.project_id, 'post')
            or public.has_project_role(d.project_id, 'producer')
            or public.has_project_role(d.project_id, 'admin')
          )
      )
    ) with check (
      exists (
        select 1 from public.deliverables d
        where d.id = deliverable_id
          and (
            public.has_project_role(d.project_id, 'post')
            or public.has_project_role(d.project_id, 'producer')
            or public.has_project_role(d.project_id, 'admin')
          )
      )
    );

  -- ─────────────────────────────────
  -- documents
  -- ─────────────────────────────────
  drop policy if exists "docs_select" on public.documents;
  drop policy if exists "docs_write"  on public.documents;

  create policy "docs_select" on public.documents
    for select using (public.is_project_member(project_id));

  create policy "docs_write" on public.documents
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'post')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'post')
      or public.has_project_role(project_id, 'admin')
    );

  -- ─────────────────────────────────
  -- document_versions (via document → project)
  -- ─────────────────────────────────
  drop policy if exists "dv_select" on public.document_versions;
  drop policy if exists "dv_write"  on public.document_versions;

  create policy "dv_select" on public.document_versions
    for select using (
      exists (
        select 1 from public.documents doc
        where doc.id = document_id
          and public.is_project_member(doc.project_id)
      )
    );

  create policy "dv_write" on public.document_versions
    for all using (
      exists (
        select 1 from public.documents doc
        where doc.id = document_id
          and (
            public.has_project_role(doc.project_id, 'producer')
            or public.has_project_role(doc.project_id, 'post')
            or public.has_project_role(doc.project_id, 'admin')
          )
      )
    ) with check (
      exists (
        select 1 from public.documents doc
        where doc.id = document_id
          and (
            public.has_project_role(doc.project_id, 'producer')
            or public.has_project_role(doc.project_id, 'post')
            or public.has_project_role(doc.project_id, 'admin')
          )
      )
    );

  -- ─────────────────────────────────
  -- attachments
  -- ─────────────────────────────────
  drop policy if exists "att_select" on public.attachments;
  drop policy if exists "att_write"  on public.attachments;

  create policy "att_select" on public.attachments
    for select using (public.is_project_member(project_id));

  create policy "att_write" on public.attachments
    for all using (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'accounting')
      or public.has_project_role(project_id, 'post')
      or public.has_project_role(project_id, 'admin')
    ) with check (
      public.has_project_role(project_id, 'producer')
      or public.has_project_role(project_id, 'accounting')
      or public.has_project_role(project_id, 'post')
      or public.has_project_role(project_id, 'admin')
    );

end $$;

-- ============================================================
-- 28. path_project_id — extrae project_id del storage path
--     path format: {project_id}/{module}/{...}/{filename}
-- ============================================================
create or replace function public.path_project_id(p_name text)
returns uuid
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_first text;
  v_uuid  uuid;
begin
  v_first := split_part(p_name, '/', 1);
  begin
    v_uuid := v_first::uuid;
  exception when others then
    return null;
  end;
  return v_uuid;
end;
$$;

-- ============================================================
-- 29. STORAGE POLICIES
--     Requiere que los buckets 'project-attachments' y
--     'project-exports' existan (créalos en Supabase Dashboard).
-- ============================================================

-- SELECT en ambos buckets
drop policy if exists "storage_select_project_buckets" on storage.objects;
create policy "storage_select_project_buckets"
  on storage.objects for select
  using (
    bucket_id in ('project-attachments', 'project-exports')
    and public.is_project_member(public.path_project_id(name))
  );

-- INSERT/UPDATE en project-attachments (producer, accounting, post, admin)
drop policy if exists "storage_write_attachments" on storage.objects;
create policy "storage_write_attachments"
  on storage.objects for insert
  with check (
    bucket_id = 'project-attachments'
    and (
      public.has_project_role(public.path_project_id(name), 'producer')
      or public.has_project_role(public.path_project_id(name), 'accounting')
      or public.has_project_role(public.path_project_id(name), 'post')
      or public.has_project_role(public.path_project_id(name), 'admin')
    )
  );

-- INSERT en project-exports (producer, admin)
drop policy if exists "storage_write_exports" on storage.objects;
create policy "storage_write_exports"
  on storage.objects for insert
  with check (
    bucket_id = 'project-exports'
    and (
      public.has_project_role(public.path_project_id(name), 'producer')
      or public.has_project_role(public.path_project_id(name), 'admin')
    )
  );

-- DELETE en project-attachments (producer, admin)
drop policy if exists "storage_delete_attachments" on storage.objects;
create policy "storage_delete_attachments"
  on storage.objects for delete
  using (
    bucket_id = 'project-attachments'
    and (
      public.has_project_role(public.path_project_id(name), 'producer')
      or public.has_project_role(public.path_project_id(name), 'admin')
    )
  );

-- ============================================================
-- FIN migration.sql
-- ============================================================
