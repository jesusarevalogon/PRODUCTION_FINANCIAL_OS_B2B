-- ============================================================
-- reset_staging.sql — SOLO PARA ENTORNO DE PRUEBAS/STAGING
-- ⚠ NUNCA ejecutar en producción.
-- Elimina datos en todas las tablas nuevas (CASCADE) y reinicia.
-- NO elimina users de auth.users ni organizations/profiles.
-- ============================================================

-- Orden inverso de dependencias para evitar FK violations
truncate table
  public.audit_log,
  public.attachments,
  public.document_versions,
  public.documents,
  public.deliverable_stage_items,
  public.deliverable_stages,
  public.deliverables,
  public.po_lines,
  public.purchase_orders,
  public.purchase_requests,
  public.daily_reports,
  public.call_sheet_versions,
  public.call_sheets,
  public.gear_reservations,
  public.gear_items,
  public.crew_assignments,
  public.crew,
  public.schedule_day_scenes,
  public.scenes,
  public.schedule_days,
  public.locations,
  public.project_members,
  public.project_state
cascade;

-- ============================================================
-- SEEDS MÍNIMOS (opcional — descomenta si quieres datos demo)
-- Requiere: un proyecto existente con id conocido y 2 usuarios.
-- ============================================================
/*
do $$
declare
  v_project_id uuid := '<REPLACE_WITH_PROJECT_ID>';
  v_user1      uuid := '<REPLACE_WITH_USER1_ID>';  -- producer
  v_user2      uuid := '<REPLACE_WITH_USER2_ID>';  -- accounting
begin
  -- Membresías demo
  insert into public.project_members(project_id, user_id, role)
  values
    (v_project_id, v_user1, 'producer'),
    (v_project_id, v_user2, 'accounting')
  on conflict do nothing;

  -- Locación demo
  insert into public.locations(project_id, name, address, contact_name)
  values (v_project_id, 'Foro Principal', 'Calle Ejemplo 123, CDMX', 'Coordinador de Locaciones');

  -- Schedule day demo
  insert into public.schedule_days(project_id, shoot_date, unit, call_time)
  values (v_project_id, current_date + 7, 'A', '07:00:00');

end $$;
*/

-- ============================================================
-- FIN reset_staging.sql
-- ============================================================
