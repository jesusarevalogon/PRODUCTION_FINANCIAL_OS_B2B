// src/services/dailyReportsService.js
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
    .from("daily_reports")
    .select(`
      *,
      schedule_day:schedule_days(id, shoot_date, unit)
    `)
    .eq("project_id", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("daily_reports")
    .select(`
      *,
      schedule_day:schedule_days(id, shoot_date, unit)
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getByDay(schedule_day_id) {
  requireSupabase();
  const pid = getProjectId();
  const { data, error } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("project_id", pid)
    .eq("schedule_day_id", schedule_day_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Crea o actualiza el DPR de un día (único por proyecto+día) */
export async function upsert({ project_id, schedule_day_id, content }) {
  requireSupabase();
  if (!schedule_day_id) throw new Error("schedule_day_id es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("daily_reports")
    .upsert(
      { project_id: pid, schedule_day_id, content: content || {} },
      { onConflict: "project_id,schedule_day_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  requireSupabase();
  const { error } = await supabase.from("daily_reports").delete().eq("id", id);
  if (error) throw error;
}
