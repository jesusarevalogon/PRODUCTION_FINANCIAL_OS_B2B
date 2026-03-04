// src/services/purchaseOrdersService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}

// ── Purchase Requests (PR) ─────────────────────────────────

export async function listPRs({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("purchase_requests")
    .select("*")
    .eq("project_id", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getPR(id) {
  requireSupabase();
  const { data, error } = await supabase.from("purchase_requests").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createPR({ project_id, notes }) {
  requireSupabase();
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("purchase_requests")
    .insert({ project_id: pid, notes, status: "draft" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePR(id, fields) {
  requireSupabase();
  const allowed = ["notes", "status"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("purchase_requests")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function submitPR(id)  { return updatePR(id, { status: "submitted" }); }
export async function approvePR(id) { return updatePR(id, { status: "approved" }); }
export async function rejectPR(id)  { return updatePR(id, { status: "rejected" }); }
export async function cancelPR(id)  { return updatePR(id, { status: "cancelled" }); }

export async function removePR(id) {
  requireSupabase();
  const { error } = await supabase.from("purchase_requests").delete().eq("id", id);
  if (error) throw error;
}

// ── Purchase Orders (PO) ───────────────────────────────────

export async function listPOs({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*, lines:po_lines(*), pr:purchase_requests(id, status, notes)")
    .eq("project_id", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getPO(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*, lines:po_lines(*), pr:purchase_requests(id, status, notes)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createPO({ project_id, pr_id, po_number, vendor, status = "draft" }) {
  requireSupabase();
  if (!po_number) throw new Error("po_number es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({ project_id: pid, pr_id, po_number, vendor, status })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePO(id, fields) {
  requireSupabase();
  const allowed = ["po_number", "vendor", "status", "pr_id", "linked_expense_id"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("purchase_orders")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removePO(id) {
  requireSupabase();
  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) throw error;
}

/** Vincula un gasto existente a un PO */
export async function linkExpense(po_id, expense_id) {
  requireSupabase();
  return updatePO(po_id, { linked_expense_id: expense_id });
}

// ── PO Lines ────────────────────────────────────────────────

export async function listLines(po_id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("po_lines")
    .select("*")
    .eq("po_id", po_id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addLine({ po_id, description, qty = 1, unit_cost = 0 }) {
  requireSupabase();
  if (!description) throw new Error("description es requerido.");
  const { data, error } = await supabase
    .from("po_lines")
    .insert({ po_id, description, qty, unit_cost })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLine(id, fields) {
  requireSupabase();
  const allowed = ["description", "qty", "unit_cost"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("po_lines")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeLine(id) {
  requireSupabase();
  const { error } = await supabase.from("po_lines").delete().eq("id", id);
  if (error) throw error;
}
