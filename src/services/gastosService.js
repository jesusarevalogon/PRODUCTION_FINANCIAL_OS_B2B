// src/services/gastosService.js
// CRUD para la tabla public.expenses (gastos reales de producción)

import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado.");
}

function getOrgId() {
  const org = window?.appState?.organization;
  if (!org?.id) throw new Error("No hay organización activa.");
  return org.id;
}

function getProjectId() {
  const proj = window?.appState?.project;
  if (!proj?.id) throw new Error("No hay proyecto activo. Selecciona un proyecto primero.");
  return proj.id;
}

// ─── LISTAR gastos del proyecto activo ───────────────────
export async function getExpenses({ projectId } = {}) {
  requireSupabase();
  const orgId = getOrgId();
  const pid = projectId || getProjectId();

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("organization_id", orgId)
    .eq("project_id", pid)
    .order("fecha", { ascending: false });

  if (error) throw error;
  return data || [];
}

// ─── CREAR gasto ─────────────────────────────────────────
export async function createExpense({
  fecha,
  cuenta,
  concepto = "",
  monto,
  proveedor = "",
  responsable = "",
} = {}) {
  requireSupabase();
  const orgId = getOrgId();
  const projectId = getProjectId();
  const userId = window?.appState?.user?.id || null;

  if (!fecha) throw new Error("La fecha es obligatoria.");
  if (!cuenta?.trim()) throw new Error("La cuenta es obligatoria.");
  if (!monto || Number(monto) <= 0) throw new Error("El monto debe ser mayor a 0.");

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      organization_id: orgId,
      project_id: projectId,
      fecha,
      cuenta: cuenta.trim(),
      concepto: concepto?.trim() || null,
      monto: Number(monto),
      proveedor: proveedor?.trim() || null,
      responsable: responsable?.trim() || null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── ACTUALIZAR gasto ────────────────────────────────────
export async function updateExpense(id, fields) {
  requireSupabase();
  const orgId = getOrgId();

  const allowed = ["fecha", "cuenta", "concepto", "monto", "proveedor", "responsable"];
  const patch = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      patch[k] = fields[k];
    }
  }
  if (patch.monto !== undefined && Number(patch.monto) <= 0) {
    throw new Error("El monto debe ser mayor a 0.");
  }

  const { data, error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── ELIMINAR gasto ──────────────────────────────────────
export async function deleteExpense(id) {
  requireSupabase();
  const orgId = getOrgId();

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw error;
}

// ─── TOTALES POR CUENTA (para Ejecución) ─────────────────
export async function getExpensesByCuenta({ projectId } = {}) {
  const expenses = await getExpenses({ projectId });

  const map = {};
  for (const e of expenses) {
    const c = String(e.cuenta || "SIN CUENTA").trim();
    if (!map[c]) map[c] = 0;
    map[c] += Number(e.monto) || 0;
  }
  return map; // { "LOCACIONES": 15000, "ALIMENTACIÓN": 8000, ... }
}
