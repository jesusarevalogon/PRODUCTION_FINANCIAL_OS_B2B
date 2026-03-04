// src/services/gearService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}

// ── Gear Items ─────────────────────────────────────────────

export async function list({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("gear_items")
    .select("*")
    .eq("project_id", pid)
    .order("type", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  requireSupabase();
  const { data, error } = await supabase.from("gear_items").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function create({ project_id, name, type, owner_type = "owned", vendor, cost_per_day, notes }) {
  requireSupabase();
  if (!name) throw new Error("name es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("gear_items")
    .insert({ project_id: pid, name, type, owner_type, vendor, cost_per_day, notes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function update(id, fields) {
  requireSupabase();
  const allowed = ["name", "type", "owner_type", "vendor", "cost_per_day", "notes"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase.from("gear_items").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  requireSupabase();
  const { error } = await supabase.from("gear_items").delete().eq("id", id);
  if (error) throw error;
}

// ── Gear Reservations ──────────────────────────────────────

export async function listReservations({ projectId, schedule_day_id } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  let q = supabase
    .from("gear_reservations")
    .select(`*, gear:gear_items(id, name, type, owner_type, cost_per_day)`)
    .eq("project_id", pid);
  if (schedule_day_id) q = q.eq("schedule_day_id", schedule_day_id);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return data || [];
}

export async function reserve({ project_id, gear_item_id, schedule_day_id, quantity = 1 }) {
  requireSupabase();
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("gear_reservations")
    .insert({ project_id: pid, gear_item_id, schedule_day_id, quantity })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReservation(id, fields) {
  requireSupabase();
  const allowed = ["quantity"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("gear_reservations")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelReservation(id) {
  requireSupabase();
  const { error } = await supabase.from("gear_reservations").delete().eq("id", id);
  if (error) throw error;
}
