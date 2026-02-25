// src/services/proyectosService.js
// CRUD para la tabla public.projects (multi-tenant por organization_id)

import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado.");
}

function getOrgId() {
  const org = window?.appState?.organization;
  if (!org?.id) throw new Error("No hay organización activa en appState.");
  return org.id;
}

// ─── LISTAR ───────────────────────────────────────────────
export async function getProjects() {
  requireSupabase();
  const orgId = getOrgId();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// ─── CREAR ────────────────────────────────────────────────
export async function createProject({ name, descripcion = "", moneda = "MXN", estado = "desarrollo", fecha_inicio = null, fecha_fin = null }) {
  requireSupabase();
  const orgId = getOrgId();

  if (!name?.trim()) throw new Error("El nombre del proyecto es obligatorio.");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      organization_id: orgId,
      name: name.trim(),
      descripcion: descripcion?.trim() || null,
      moneda,
      estado,
      fecha_inicio: fecha_inicio || null,
      fecha_fin: fecha_fin || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── ACTUALIZAR ───────────────────────────────────────────
export async function updateProject(id, fields) {
  requireSupabase();
  const orgId = getOrgId();

  const allowed = ["name", "descripcion", "moneda", "estado", "fecha_inicio", "fecha_fin"];
  const patch = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      patch[k] = fields[k];
    }
  }

  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── ELIMINAR ─────────────────────────────────────────────
export async function deleteProject(id) {
  requireSupabase();
  const orgId = getOrgId();

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw error;
}

// ─── OBTENER UNO ──────────────────────────────────────────
export async function getProjectById(id) {
  requireSupabase();
  const orgId = getOrgId();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

// ─── ESTADOS VÁLIDOS ──────────────────────────────────────
export const ESTADOS_PROYECTO = [
  { value: "desarrollo",      label: "Desarrollo" },
  { value: "preproduccion",   label: "Preproducción" },
  { value: "produccion",      label: "Producción" },
  { value: "posproduccion",   label: "Posproducción" },
  { value: "entrega",         label: "Entrega" },
];

export const MONEDAS = [
  { value: "MXN", label: "MXN — Peso mexicano" },
  { value: "USD", label: "USD — Dólar americano" },
  { value: "EUR", label: "EUR — Euro" },
];
