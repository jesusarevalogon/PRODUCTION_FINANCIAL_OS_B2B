// src/services/locationsService.js
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
    .from("locations")
    .select("*")
    .eq("project_id", pid)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  requireSupabase();
  const { data, error } = await supabase.from("locations").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function create({ project_id, name, address, contact_name, contact_phone, restrictions, notes }) {
  requireSupabase();
  if (!name) throw new Error("name es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("locations")
    .insert({ project_id: pid, name, address, contact_name, contact_phone, restrictions, notes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function update(id, fields) {
  requireSupabase();
  const allowed = ["name", "address", "contact_name", "contact_phone", "restrictions", "notes"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase.from("locations").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  requireSupabase();
  const { error } = await supabase.from("locations").delete().eq("id", id);
  if (error) throw error;
}
