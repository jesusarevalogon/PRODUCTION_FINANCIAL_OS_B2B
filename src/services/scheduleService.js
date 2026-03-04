// src/services/scheduleService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}

// ── Schedule Days ──────────────────────────────────────────

export async function listDays({ projectId, from, to } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  let q = supabase
    .from("schedule_days")
    .select(`
      *,
      primary_location:locations(id, name, address),
      scenes:schedule_day_scenes(
        id, order_index,
        scene:scenes(id, code, pages, description)
      ),
      crew_assignments(
        id, call_time,
        crew:crew(id, name, role_name, phone)
      )
    `)
    .eq("project_id", pid)
    .order("shoot_date", { ascending: true })
    .order("unit", { ascending: true });

  if (from) q = q.gte("shoot_date", from);
  if (to)   q = q.lte("shoot_date", to);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getDay(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("schedule_days")
    .select(`
      *,
      primary_location:locations(id, name, address),
      scenes:schedule_day_scenes(
        id, order_index,
        scene:scenes(id, code, pages, description)
      ),
      crew_assignments(
        id, call_time,
        crew:crew(id, name, role_name, phone)
      )
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createDay({ project_id, shoot_date, unit = "A", primary_location_id, call_time, notes }) {
  requireSupabase();
  if (!shoot_date) throw new Error("shoot_date es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("schedule_days")
    .insert({ project_id: pid, shoot_date, unit, primary_location_id, call_time, notes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDay(id, fields) {
  requireSupabase();
  const allowed = ["shoot_date", "unit", "primary_location_id", "call_time", "notes"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("schedule_days")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeDay(id) {
  requireSupabase();
  const { error } = await supabase.from("schedule_days").delete().eq("id", id);
  if (error) throw error;
}

// ── Scenes ─────────────────────────────────────────────────

export async function listScenes({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("project_id", pid)
    .order("code", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createScene({ project_id, code, pages, description }) {
  requireSupabase();
  if (!code) throw new Error("code es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("scenes")
    .insert({ project_id: pid, code, pages, description })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateScene(id, fields) {
  requireSupabase();
  const allowed = ["code", "pages", "description"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("scenes")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeScene(id) {
  requireSupabase();
  const { error } = await supabase.from("scenes").delete().eq("id", id);
  if (error) throw error;
}

// ── Schedule Day Scenes ────────────────────────────────────

export async function addSceneToDay(schedule_day_id, scene_id, order_index = 0) {
  requireSupabase();
  const { data, error } = await supabase
    .from("schedule_day_scenes")
    .insert({ schedule_day_id, scene_id, order_index })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeSceneFromDay(schedule_day_id, scene_id) {
  requireSupabase();
  const { error } = await supabase
    .from("schedule_day_scenes")
    .delete()
    .eq("schedule_day_id", schedule_day_id)
    .eq("scene_id", scene_id);
  if (error) throw error;
}

/** Reordena las escenas de un día.
 *  ordered_scene_ids: array de scene_ids en el nuevo orden */
export async function reorderScenes(schedule_day_id, ordered_scene_ids) {
  requireSupabase();
  const updates = ordered_scene_ids.map((scene_id, idx) =>
    supabase
      .from("schedule_day_scenes")
      .update({ order_index: idx })
      .eq("schedule_day_id", schedule_day_id)
      .eq("scene_id", scene_id)
  );
  await Promise.all(updates);
}
