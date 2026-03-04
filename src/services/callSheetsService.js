// src/services/callSheetsService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}

export async function list({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("call_sheets")
    .select(`
      *,
      schedule_day:schedule_days(id, shoot_date, unit, call_time,
        primary_location:locations(id, name))
    `)
    .eq("project_id", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function get(call_sheet_id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("call_sheets")
    .select(`
      *,
      schedule_day:schedule_days(
        id, shoot_date, unit, call_time, notes,
        primary_location:locations(id, name, address, contact_name, contact_phone),
        scenes:schedule_day_scenes(
          id, order_index,
          scene:scenes(id, code, pages, description)
        ),
        crew_assignments(
          id, call_time,
          crew:crew(id, name, role_name, phone, email)
        )
      )
    `)
    .eq("id", call_sheet_id)
    .single();
  if (error) throw error;
  return data;
}

export async function create({ project_id, schedule_day_id }) {
  requireSupabase();
  if (!schedule_day_id) throw new Error("schedule_day_id es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("call_sheets")
    .insert({ project_id: pid, schedule_day_id, status: "draft", current_version: 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateStatus(call_sheet_id, status) {
  requireSupabase();
  const allowed = ["draft", "review", "published"];
  if (!allowed.includes(status)) throw new Error(`Estado inválido: ${status}`);
  const { data, error } = await supabase
    .from("call_sheets")
    .update({ status })
    .eq("id", call_sheet_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Llama al RPC publish_call_sheet. Devuelve { version_number } */
export async function publish(call_sheet_id) {
  requireSupabase();
  const { data, error } = await supabase.rpc("publish_call_sheet", {
    p_call_sheet_id: call_sheet_id,
  });
  if (error) throw error;
  return data?.[0] || data;
}

/** Obtiene una versión específica (o la más reciente si no se pasa version_number) */
export async function getVersion(call_sheet_id, version_number) {
  requireSupabase();
  let q = supabase
    .from("call_sheet_versions")
    .select("*")
    .eq("call_sheet_id", call_sheet_id)
    .order("version_number", { ascending: false });

  if (version_number) q = q.eq("version_number", version_number);

  const { data, error } = await q.limit(1).single();
  if (error) throw error;
  return data;
}

export async function remove(call_sheet_id) {
  requireSupabase();
  const { error } = await supabase
    .from("call_sheets")
    .delete()
    .eq("id", call_sheet_id);
  if (error) throw error;
}
