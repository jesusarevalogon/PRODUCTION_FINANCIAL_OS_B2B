// src/services/deliverablesService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}

const ALL_STAGES = [
  { stage_name: "edit",   order_index: 0 },
  { stage_name: "color",  order_index: 1 },
  { stage_name: "audio",  order_index: 2 },
  { stage_name: "vfx",    order_index: 3 },
  { stage_name: "qc",     order_index: 4 },
  { stage_name: "final",  order_index: 5 },
];

// ── Deliverables ───────────────────────────────────────────

export async function list({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("deliverables")
    .select(`
      *,
      stages:deliverable_stages(id, stage_name, order_index),
      kanban:deliverable_stage_items(id, stage_name, title, description, status, order_index)
    `)
    .eq("project_id", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("deliverables")
    .select(`
      *,
      stages:deliverable_stages(id, stage_name, order_index),
      kanban:deliverable_stage_items(id, stage_name, title, description, status, order_index)
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

/** Crea el deliverable Y auto-genera las 6 stages estándar */
export async function create({ project_id, name, specs }) {
  requireSupabase();
  if (!name) throw new Error("name es requerido.");
  const pid = project_id || getProjectId();

  // 1. Crear deliverable
  const { data: deliv, error: dErr } = await supabase
    .from("deliverables")
    .insert({ project_id: pid, name, specs: specs || {} })
    .select()
    .single();
  if (dErr) throw dErr;

  // 2. Auto-crear las 6 stages
  const stageRows = ALL_STAGES.map((s) => ({
    deliverable_id: deliv.id,
    stage_name:     s.stage_name,
    order_index:    s.order_index,
  }));
  const { error: sErr } = await supabase.from("deliverable_stages").insert(stageRows);
  if (sErr) console.warn("[deliverablesService] No se pudieron crear stages:", sErr.message);

  return deliv;
}

export async function update(id, fields) {
  requireSupabase();
  const allowed = ["name", "specs", "status"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase.from("deliverables").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  requireSupabase();
  const { error } = await supabase.from("deliverables").delete().eq("id", id);
  if (error) throw error;
}

// ── Kanban Items ───────────────────────────────────────────

export async function listItems(deliverable_id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("deliverable_stage_items")
    .select("*")
    .eq("deliverable_id", deliverable_id)
    .order("stage_name")
    .order("order_index");
  if (error) throw error;
  return data || [];
}

export async function addItem({ deliverable_id, stage_name, title, description, order_index = 0 }) {
  requireSupabase();
  if (!title) throw new Error("title es requerido.");
  const { data, error } = await supabase
    .from("deliverable_stage_items")
    .insert({ deliverable_id, stage_name, title, description, order_index, status: "todo" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateItem(id, fields) {
  requireSupabase();
  const allowed = ["title", "description", "status", "stage_name", "order_index"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("deliverable_stage_items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Mueve un item a otro stage y/o status */
export async function moveItem(id, { stage_name, status }) {
  return updateItem(id, { stage_name, status });
}

export async function removeItem(id) {
  requireSupabase();
  const { error } = await supabase.from("deliverable_stage_items").delete().eq("id", id);
  if (error) throw error;
}
