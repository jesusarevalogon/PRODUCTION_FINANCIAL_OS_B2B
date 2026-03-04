// src/services/crewService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}

// ── Crew ────────────────────────────────────────────────────

export async function list({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("crew")
    .select("*")
    .eq("project_id", pid)
    .order("role_name", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  requireSupabase();
  const { data, error } = await supabase.from("crew").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function create({ project_id, name, role_name, rate, phone, email, notes }) {
  requireSupabase();
  if (!name) throw new Error("name es requerido.");
  if (!role_name) throw new Error("role_name es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("crew")
    .insert({ project_id: pid, name, role_name, rate, phone, email, notes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function update(id, fields) {
  requireSupabase();
  const allowed = ["name", "role_name", "rate", "phone", "email", "notes"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase.from("crew").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  requireSupabase();
  const { error } = await supabase.from("crew").delete().eq("id", id);
  if (error) throw error;
}

// ── Crew Assignments ────────────────────────────────────────

export async function listAssignments({ projectId, schedule_day_id } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  let q = supabase
    .from("crew_assignments")
    .select(`*, crew:crew(id, name, role_name, phone, email)`)
    .eq("project_id", pid);
  if (schedule_day_id) q = q.eq("schedule_day_id", schedule_day_id);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return data || [];
}

export async function assign({ project_id, schedule_day_id, crew_id, call_time }) {
  requireSupabase();
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("crew_assignments")
    .insert({ project_id: pid, schedule_day_id, crew_id, call_time })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAssignment(id, fields) {
  requireSupabase();
  const allowed = ["call_time"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("crew_assignments")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function unassign(id) {
  requireSupabase();
  const { error } = await supabase.from("crew_assignments").delete().eq("id", id);
  if (error) throw error;
}
