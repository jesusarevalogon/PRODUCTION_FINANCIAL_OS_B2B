// src/modules/documentos.js
// Módulo: Documentos maestros + versiones
import {
  list as listDocs, create as createDoc, remove as removeDoc,
  listVersions, uploadVersion, getSignedUrl,
} from "../services/documentsService.js";
import { DOCUMENT_TYPES } from "../utils/constants.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}

const TYPE_LABELS = {
  script: "Guion", budget: "Presupuesto", schedule: "Schedule",
  call_sheet: "Call Sheet", release: "Release", insurance: "Seguro",
  contract: "Contrato", guide: "Guía", other: "Otro",
};

export function renderDocumentosView() {
  return `
<div class="container" style="padding-top:16px;">
  <div class="card" style="padding:0;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 18px 0;">
      <h2 style="margin:0;">Documentos Maestros</h2>
      <button class="btn btn-primary btn-xs" id="btnAddDoc">+ Nuevo documento</button>
    </div>
    <div style="padding:18px;">
      <div id="docList"><div class="muted">Cargando…</div></div>

      <!-- Panel de versiones -->
      <div id="versionsPanel" style="display:none;margin-top:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 id="versionsPanelTitle" style="margin:0;"></h3>
          <button class="btn btn-ghost btn-xs" id="btnCloseVersions">← Volver</button>
        </div>
        <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input id="versionFileInput" type="file" accept="application/pdf,image/*" style="flex:1;min-width:0;" />
          <input id="versionNotes" type="text" placeholder="Notas de versión (opcional)" style="flex:2;min-width:0;" />
          <button class="btn btn-primary btn-xs" id="btnUploadVersion">Subir versión</button>
          <span id="uploadMsg" class="muted" style="font-size:11px;"></span>
        </div>
        <div id="versionsList"><div class="muted">Cargando versiones…</div></div>
      </div>
    </div>

    <!-- Modal nuevo documento -->
    <div id="docModalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header"><h3>Nuevo Documento</h3></div>
        <div class="modal-body">
          <div class="form-grid">
            <label style="grid-column:1/-1;">Título *<input id="docTitle" type="text" /></label>
            <label style="grid-column:1/-1;">Tipo *
              <select id="docType">
                ${DOCUMENT_TYPES.map((t) => `<option value="${t}">${TYPE_LABELS[t] || t}</option>`).join("")}
              </select>
            </label>
          </div>
          <p id="docErr" class="error" style="display:none;"></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="docCancel">Cancelar</button>
          <button class="btn btn-primary" id="docSave">Crear</button>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

export async function bindDocumentosEvents() {
  let currentDocId = null;

  async function loadDocList() {
    const el = document.getElementById("docList");
    try {
      const docs = await listDocs();
      if (!docs.length) { el.innerHTML = `<p class="muted">Sin documentos. Crea el primero.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>Título</th><th>Tipo</th><th>Versión actual</th><th></th></tr></thead><tbody>
        ${docs.map((d) => `<tr>
          <td>${escapeHtml(d.title)}</td>
          <td><span style="font-size:11px;padding:2px 6px;background:rgba(255,255,255,.1);border-radius:4px;">${escapeHtml(TYPE_LABELS[d.type] || d.type)}</span></td>
          <td>${d.current_version ? `v${d.current_version.version_number}` : "—"}</td>
          <td style="display:flex;gap:6px;">
            ${d.current_version ? `<button class="btn btn-ghost btn-xs" data-download="${escapeHtml(d.current_version.storage_path)}" data-bucket="${escapeHtml(d.current_version.storage_bucket)}">⬇</button>` : ""}
            <button class="btn btn-primary btn-xs" data-open-versions="${escapeHtml(d.id)}" data-doc-title="${escapeHtml(d.title)}">Versiones</button>
            <button class="btn btn-danger btn-xs" data-del-doc="${escapeHtml(d.id)}">✕</button>
          </td>
        </tr>`).join("")}
      </tbody></table>`;

      el.querySelectorAll("[data-download]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const url = await getSignedUrl(btn.dataset.download, btn.dataset.bucket);
            window.open(url, "_blank");
          } catch (e) { alert(e.message); }
          finally { btn.disabled = false; }
        });
      });

      el.querySelectorAll("[data-open-versions]").forEach((btn) => {
        btn.addEventListener("click", () => openVersionsPanel(btn.dataset.openVersions, btn.dataset.docTitle));
      });

      el.querySelectorAll("[data-del-doc]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar documento y todas sus versiones?")) return;
          try { await removeDoc(btn.dataset.delDoc); await loadDocList(); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  async function openVersionsPanel(docId, title) {
    currentDocId = docId;
    document.getElementById("docList").style.display = "none";
    document.getElementById("versionsPanel").style.display = "block";
    document.getElementById("versionsPanelTitle").textContent = title;
    await loadVersionsList(docId);
  }

  async function loadVersionsList(docId) {
    const el = document.getElementById("versionsList");
    el.innerHTML = `<div class="muted">Cargando…</div>`;
    try {
      const versions = await listVersions(docId);
      if (!versions.length) { el.innerHTML = `<p class="muted">Sin versiones. Sube la primera.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>#</th><th>Notas</th><th>Fecha</th><th></th></tr></thead><tbody>
        ${versions.map((v) => `<tr>
          <td>v${v.version_number}</td>
          <td>${v.notes ? escapeHtml(v.notes) : "—"}</td>
          <td>${new Date(v.created_at).toLocaleDateString("es-MX")}</td>
          <td>
            <button class="btn btn-ghost btn-xs" data-dl-path="${escapeHtml(v.storage_path)}" data-dl-bucket="${escapeHtml(v.storage_bucket)}">⬇ Descargar</button>
          </td>
        </tr>`).join("")}
      </tbody></table>`;
      el.querySelectorAll("[data-dl-path]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const url = await getSignedUrl(btn.dataset.dlPath, btn.dataset.dlBucket);
            window.open(url, "_blank");
          } catch (e) { alert(e.message); }
          finally { btn.disabled = false; }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  document.getElementById("btnCloseVersions")?.addEventListener("click", () => {
    document.getElementById("versionsPanel").style.display = "none";
    document.getElementById("docList").style.display = "block";
    currentDocId = null;
  });

  document.getElementById("btnUploadVersion")?.addEventListener("click", async () => {
    if (!currentDocId) return;
    const fileInput = document.getElementById("versionFileInput");
    const notes     = document.getElementById("versionNotes").value.trim() || null;
    const msgEl     = document.getElementById("uploadMsg");
    const file      = fileInput.files?.[0];
    if (!file) { alert("Selecciona un archivo."); return; }
    const btn = document.getElementById("btnUploadVersion"); btn.disabled = true;
    msgEl.textContent = "Subiendo…";
    try {
      const { version } = await uploadVersion(currentDocId, file, notes);
      fileInput.value = "";
      document.getElementById("versionNotes").value = "";
      msgEl.textContent = `✓ v${version.version_number} subida`;
      setTimeout(() => { msgEl.textContent = ""; }, 3000);
      await loadVersionsList(currentDocId);
    } catch (e) { msgEl.textContent = `Error: ${e.message}`; }
    finally { btn.disabled = false; }
  });

  // ── Modal nuevo doc ──
  const backdrop = document.getElementById("docModalBackdrop");
  document.getElementById("btnAddDoc")?.addEventListener("click", () => { backdrop.style.display = "flex"; });
  document.getElementById("docCancel")?.addEventListener("click", () => { backdrop.style.display = "none"; });
  document.getElementById("docSave")?.addEventListener("click", async () => {
    const title = document.getElementById("docTitle").value.trim();
    const type  = document.getElementById("docType").value;
    const errEl = document.getElementById("docErr");
    if (!title) { errEl.textContent = "El título es requerido."; errEl.style.display = "block"; return; }
    errEl.style.display = "none";
    const btn = document.getElementById("docSave"); btn.disabled = true;
    try {
      await createDoc({ title, type });
      backdrop.style.display = "none";
      document.getElementById("docTitle").value = "";
      await loadDocList();
    } catch (e) { errEl.textContent = e.message; errEl.style.display = "block"; }
    finally { btn.disabled = false; }
  });

  await loadDocList();
}
