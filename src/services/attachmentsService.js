// src/services/attachmentsService.js
// Servicio genérico de adjuntos (Storage + project_state)
// Estado por módulo: { [docKey]: { fileName, mime, path, updatedAt, ...extraMeta } }

import { supabase } from "./supabase.js";
import { loadModuleState, saveModuleState } from "./stateService.js";
import {
  buildStoragePath,
  uploadFile,
  removeFiles,
  createSignedUrl,
  downloadFile,
} from "./storageService.js";
import { validarContextoV2 } from "./validators.js";
import { STORAGE_BUCKET } from "../utils/constants.js";

// --------- Local fallback (si no hay Supabase) ----------
const LS_PREFIX = "ATTACHMENTS_V1__";

function getLocalKey(moduleKey) {
  return `${LS_PREFIX}${moduleKey || "module"}`;
}

function localLoad(moduleKey) {
  try {
    const raw = localStorage.getItem(getLocalKey(moduleKey));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function localSave(moduleKey, data) {
  localStorage.setItem(getLocalKey(moduleKey), JSON.stringify(data || {}));
}

// --------- Session helper ----------
function getSessionIds() {
  const userId = window?.appState?.user?.uid || null;
  const projectId = window?.appState?.profile?.projectId || null;
  return { userId, projectId };
}

// --------- Core helpers ----------
async function loadStore({ userId, projectId, moduleKey }) {
  // Supabase mode
  if (supabase && userId && projectId) {
    const state = await loadModuleState({ userId, projectId, moduleKey });
    return state || {};
  }
  // Local fallback
  return localLoad(moduleKey);
}

async function saveStore({ userId, projectId, moduleKey, store }) {
  if (supabase && userId && projectId) {
    await saveModuleState({ userId, projectId, moduleKey, data: store || {} });
    return;
  }
  localSave(moduleKey, store || {});
}

async function safeDeletePrevPath(prevPath) {
  if (!prevPath) return;
  if (!supabase) return; // en local no hay storage
  try {
    await removeFiles({ paths: [prevPath], bucket: STORAGE_BUCKET });
  } catch (e) {
    // no bloqueamos por limpieza
    console.warn("No se pudo borrar archivo anterior:", e);
  }
}

// =========================================================
// API PUBLICA
// =========================================================

/**
 * Obtiene el estado de adjuntos del módulo.
 */
export async function getModuleAttachments({ userId, projectId, moduleKey } = {}) {
  const ids = getSessionIds();
  const ctx = {
    userId: userId || ids.userId,
    projectId: projectId || ids.projectId,
    moduleKey,
  };

  // Si estamos en Supabase, exigimos contexto.
  if (supabase) validarContextoV2(ctx);

  return await loadStore(ctx);
}

/**
 * Sube/Reemplaza un adjunto y guarda metadata en project_state.
 *
 * @param {Object} p
 * @param {string} p.moduleKey  - module_key en project_state
 * @param {string} p.docKey     - key del documento (ej. "equipo_propuesto")
 * @param {File|Blob} p.file
 * @param {string} [p.area]     - carpeta dentro del proyecto (default = moduleKey)
 * @param {Object} [p.extraMeta]
 * @param {string} [p.userId]
 * @param {string} [p.projectId]
 */
export async function uploadAttachment({
  userId,
  projectId,
  moduleKey,
  docKey,
  file,
  area,
  extraMeta,
} = {}) {
  const ids = getSessionIds();
  const ctx = {
    userId: userId || ids.userId,
    projectId: projectId || ids.projectId,
    moduleKey,
  };

  if (supabase) validarContextoV2(ctx);
  if (!docKey) throw new Error("Falta docKey.");
  if (!file) throw new Error("Falta file.");

  const store = await loadStore(ctx);

  // Si existe previo, intentamos borrarlo (limpieza)
  const prev = store?.[docKey];
  await safeDeletePrevPath(prev?.path);

  // Local fallback: guardamos “pseudo metadata” sin path real
  if (!supabase || !ctx.userId || !ctx.projectId) {
    store[docKey] = {
      fileName: file.name || "archivo",
      mime: file.type || "",
      path: null,
      updatedAt: Date.now(),
      ...(extraMeta || {}),
      __local: true,
    };
    await saveStore({ ...ctx, store });
    return { store, entry: store[docKey] };
  }

  const finalArea = area || moduleKey || "adjuntos";
  const path = buildStoragePath({
    userId: ctx.userId,
    projectId: ctx.projectId,
    area: finalArea,
    docKey,
    filename: file.name || "archivo",
  });

  // Upload
  await uploadFile({
    file,
    path,
    bucket: STORAGE_BUCKET,
    upsert: true,
    contentType: file.type || undefined,
  });

  // Metadata
  const entry = {
    fileName: file.name || "archivo",
    mime: file.type || "",
    path,
    updatedAt: Date.now(),
    ...(extraMeta || {}),
  };

  store[docKey] = entry;
  await saveStore({ ...ctx, store });

  return { store, entry };
}

/**
 * Elimina un adjunto del Storage (si existe) y lo quita del state.
 */
export async function removeAttachment({ userId, projectId, moduleKey, docKey } = {}) {
  const ids = getSessionIds();
  const ctx = {
    userId: userId || ids.userId,
    projectId: projectId || ids.projectId,
    moduleKey,
  };

  if (supabase) validarContextoV2(ctx);
  if (!docKey) throw new Error("Falta docKey.");

  const store = await loadStore(ctx);
  const prev = store?.[docKey];

  if (prev?.path && supabase) {
    await safeDeletePrevPath(prev.path);
  }

  if (store && Object.prototype.hasOwnProperty.call(store, docKey)) {
    delete store[docKey];
  }

  await saveStore({ ...ctx, store });
  return { store };
}

/**
 * Genera Signed URL (ideal para vista previa en bucket privado).
 * expiresIn en segundos (default 1 hora).
 */
export async function getAttachmentSignedUrl({
  userId,
  projectId,
  moduleKey,
  docKey,
  expiresIn = 60 * 60,
} = {}) {
  const ids = getSessionIds();
  const ctx = {
    userId: userId || ids.userId,
    projectId: projectId || ids.projectId,
    moduleKey,
  };

  if (!supabase) throw new Error("Supabase no está disponible para signed URLs.");
  validarContextoV2(ctx);
  if (!docKey) throw new Error("Falta docKey.");

  const store = await loadStore(ctx);
  const entry = store?.[docKey];
  if (!entry?.path) throw new Error("No hay archivo para este docKey.");

  const url = await createSignedUrl({
    path: entry.path,
    bucket: STORAGE_BUCKET,
    expiresIn,
  });

  return { url, entry };
}

/**
 * Descarga el archivo como Blob.
 */
export async function downloadAttachmentBlob({ userId, projectId, moduleKey, docKey } = {}) {
  const ids = getSessionIds();
  const ctx = {
    userId: userId || ids.userId,
    projectId: projectId || ids.projectId,
    moduleKey,
  };

  if (!supabase) throw new Error("Supabase no está disponible para descarga.");
  validarContextoV2(ctx);
  if (!docKey) throw new Error("Falta docKey.");

  const store = await loadStore(ctx);
  const entry = store?.[docKey];
  if (!entry?.path) throw new Error("No hay archivo para este docKey.");

  const blob = await downloadFile({ path: entry.path, bucket: STORAGE_BUCKET });
  return { blob, entry };
}

// Mantengo noop por compatibilidad
export function noop() {}

// =========================================================
// API V2 — attachments TABLE (transversal por entidad)
// Usa el bucket 'project-attachments' y la tabla `attachments`.
// =========================================================

const ATTACHMENTS_BUCKET = "project-attachments";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no inicializado.");
}
function getProjectId() {
  const id = window?.appState?.project?.id;
  if (!id) throw new Error("No hay proyecto activo.");
  return id;
}
function nowStamp() { return Date.now(); }
function safeFileName(name) {
  return String(name || "archivo")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

/**
 * Lista adjuntos de una entidad específica.
 * @param {string} module   - 'expenses' | 'call_sheets' | 'documents' | etc.
 * @param {string} entity_id
 * @param {string} [projectId]
 */
export async function listAttachments({ module, entity_id, projectId } = {}) {
  requireSupabase();
  const pid = projectId || getProjectId();
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("project_id", pid)
    .eq("module", module)
    .eq("entity_id", entity_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Sube un archivo y lo registra en la tabla attachments.
 * Si falla el INSERT, borra el objeto del storage (best-effort).
 *
 * @param {Object} p
 * @param {string}   p.module    - módulo (ej. 'expenses')
 * @param {string}   p.entity_id - UUID de la entidad
 * @param {File}     p.file
 * @param {string}   [p.projectId]
 * @returns {Promise<Object>} row de attachments
 */
export async function addAttachment({ module, entity_id, file, projectId } = {}) {
  requireSupabase();
  if (!module)    throw new Error("module es requerido.");
  if (!entity_id) throw new Error("entity_id es requerido.");
  if (!file)      throw new Error("file es requerido.");

  const pid = projectId || getProjectId();
  const safeName = safeFileName(file.name);
  const storagePath = `${pid}/${module}/${entity_id}/${nowStamp()}_${safeName}`;

  // 1. Subir a storage
  await uploadFile({
    file,
    path: storagePath,
    bucket: ATTACHMENTS_BUCKET,
    upsert: false,
    contentType: file.type || undefined,
  });

  // 2. Insertar registro en tabla
  const { data, error } = await supabase
    .from("attachments")
    .insert({
      project_id:     pid,
      module,
      entity_id,
      storage_bucket: ATTACHMENTS_BUCKET,
      storage_path:   storagePath,
      mime_type:      file.type || null,
      size_bytes:     file.size || null,
    })
    .select()
    .single();

  if (error) {
    // Best-effort: limpiar storage si falla el INSERT
    try {
      await removeFiles({ paths: [storagePath], bucket: ATTACHMENTS_BUCKET });
    } catch { /* ignore cleanup error */ }
    throw error;
  }

  return data;
}

/**
 * Genera signed URL para un attachment.
 * @param {string} attachment_id
 * @param {number} [expiresIn=3600]
 */
export async function getAttachmentUrl(attachment_id, expiresIn = 3600) {
  requireSupabase();
  const { data, error } = await supabase
    .from("attachments")
    .select("storage_path, storage_bucket")
    .eq("id", attachment_id)
    .single();
  if (error) throw error;
  return createSignedUrl({ path: data.storage_path, bucket: data.storage_bucket, expiresIn });
}

/**
 * Elimina el attachment (tabla + storage best-effort).
 * @param {string} attachment_id
 */
export async function deleteAttachment(attachment_id) {
  requireSupabase();
  const { data, error } = await supabase
    .from("attachments")
    .select("storage_path, storage_bucket")
    .eq("id", attachment_id)
    .single();
  if (error) throw error;

  // Borrar de tabla
  const { error: delErr } = await supabase.from("attachments").delete().eq("id", attachment_id);
  if (delErr) throw delErr;

  // Best-effort: limpiar storage
  try {
    await removeFiles({ paths: [data.storage_path], bucket: data.storage_bucket });
  } catch { /* ignore */ }
}
