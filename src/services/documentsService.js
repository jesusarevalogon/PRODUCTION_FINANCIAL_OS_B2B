// src/services/documentsService.js
import { supabase } from "./supabase.js";
import { uploadFile, createSignedUrl } from "./storageService.js";
import { safeFileName, joinPath } from "../utils/constants.js";

const EXPORT_BUCKET = "project-exports";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}
function nowStamp() { return Date.now(); }

// ── Documents ──────────────────────────────────────────────

export async function list({ projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("documents")
    .select(`
      *,
      current_version:document_versions!documents_current_version_id_fkey(
        id, version_number, storage_path, storage_bucket, notes, created_at
      ),
      versions:document_versions(id, version_number, notes, created_at)
    `)
    .eq("project_id", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select(`
      *,
      current_version:document_versions!documents_current_version_id_fkey(
        id, version_number, storage_path, storage_bucket, notes, created_at
      ),
      versions:document_versions(id, version_number, notes, created_at)
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function create({ project_id, type, title }) {
  requireSupabase();
  if (!title) throw new Error("title es requerido.");
  if (!type)  throw new Error("type es requerido.");
  const pid = project_id || getProjectId();
  const { data, error } = await supabase
    .from("documents")
    .insert({ project_id: pid, type, title })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function update(id, fields) {
  requireSupabase();
  const allowed = ["title", "type"];
  const payload = {};
  for (const k of allowed) if (k in fields) payload[k] = fields[k];
  const { data, error } = await supabase
    .from("documents")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  requireSupabase();
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw error;
}

// ── Document Versions ──────────────────────────────────────

export async function listVersions(document_id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", document_id)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Sube archivo a storage, crea document_version, y actualiza current_version_id.
 * @param {string} document_id
 * @param {File}   file
 * @param {string} [notes]
 * @returns {Promise<{version: object, signed_url: string}>}
 */
export async function uploadVersion(document_id, file, notes) {
  requireSupabase();
  if (!file) throw new Error("file es requerido.");

  // Obtener número de versión siguiente
  const { data: existing, error: vErr } = await supabase
    .from("document_versions")
    .select("version_number")
    .eq("document_id", document_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vErr) throw vErr;

  const newVersionNumber = (existing?.version_number || 0) + 1;

  // Obtener project_id del documento
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("project_id, type")
    .eq("id", document_id)
    .single();
  if (docErr) throw docErr;

  const pid = doc.project_id;
  const yyyymm = new Date().toISOString().slice(0, 7); // "2026-03"
  const safeName = safeFileName(file.name);
  const storagePath = joinPath(pid, "documents", document_id, `v${newVersionNumber}_${nowStamp()}_${safeName}`);

  // Subir archivo
  await uploadFile({
    file,
    path: storagePath,
    bucket: EXPORT_BUCKET,
    upsert: false,
    contentType: file.type || undefined,
  });

  // Insertar versión
  const { data: version, error: insErr } = await supabase
    .from("document_versions")
    .insert({
      document_id,
      version_number: newVersionNumber,
      storage_bucket: EXPORT_BUCKET,
      storage_path:   storagePath,
      notes,
    })
    .select()
    .single();
  if (insErr) throw insErr;

  // Actualizar current_version_id en documento
  await supabase
    .from("documents")
    .update({ current_version_id: version.id })
    .eq("id", document_id);

  // Generar signed URL
  const signed_url = await createSignedUrl({ path: storagePath, bucket: EXPORT_BUCKET, expiresIn: 300 });

  return { version, signed_url };
}

export async function getSignedUrl(storage_path, bucket = EXPORT_BUCKET, expiresIn = 300) {
  return createSignedUrl({ path: storage_path, bucket, expiresIn });
}
