// src/modules/post.js
// Módulo: Post — Deliverables + Kanban
import {
  list as listDeliverables, create as createDeliverable, update as updateDeliverable, remove as removeDeliverable,
  addItem as addKanbanItem, updateItem as updateKanbanItem, removeItem as removeKanbanItem,
  listItems,
} from "../services/deliverablesService.js";
import { STAGE_NAMES, DELIVERABLE_STATUS } from "../utils/constants.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}

const STAGE_LABELS = { edit: "Edición", color: "Color", audio: "Audio", vfx: "VFX", qc: "QC", final: "Final" };
const STATUS_COLORS = { todo: "rgba(255,255,255,.15)", doing: "#f4b740", done: "#38c172" };
const DELIV_STATUS_COLORS = { todo: "rgba(255,255,255,.15)", in_progress: "#4f7cff", needs_review: "#f4b740", approved: "#38c172", delivered: "#38c172" };

export function renderPostView() {
  return `
<div class="container" style="padding-top:16px;">
  <div class="card" style="padding:0;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 18px 0;">
      <h2 style="margin:0;">Post-producción — Deliverables</h2>
      <button class="btn btn-primary btn-xs" id="btnAddDeliv">+ Nuevo deliverable</button>
    </div>

    <div style="padding:18px;">
      <div id="delivList"><div class="muted">Cargando…</div></div>
      <div id="kanbanView" style="display:none;margin-top:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 id="kanbanTitle" style="margin:0;"></h3>
          <button class="btn btn-ghost btn-xs" id="btnCloseKanban">← Volver</button>
        </div>
        <div id="kanbanBoard" style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;overflow-x:auto;min-width:0;"></div>
        <div style="margin-top:16px;display:flex;gap:8px;align-items:center;">
          <select id="kanbanStageAdd" style="flex:1;max-width:180px;">
            ${STAGE_NAMES.map((s) => `<option value="${s}">${STAGE_LABELS[s]}</option>`).join("")}
          </select>
          <input id="kanbanItemTitle" type="text" placeholder="Título de la tarea…" style="flex:2;" />
          <button class="btn btn-primary btn-xs" id="kanbanAddItem">+ Agregar</button>
        </div>
      </div>
    </div>

    <!-- Modal nuevo deliverable -->
    <div id="delivModalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width:440px;">
        <div class="modal-header"><h3>Nuevo Deliverable</h3></div>
        <div class="modal-body">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;">
            Nombre *<input id="delivName" type="text" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;margin-top:10px;">
            Especificaciones (JSON opcional)<textarea id="delivSpecs" rows="3" placeholder='{"format":"DCP","resolution":"4K"}'></textarea>
          </label>
          <p id="delivErr" class="error" style="display:none;"></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="delivCancel">Cancelar</button>
          <button class="btn btn-primary" id="delivSave">Crear</button>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

export async function bindPostEvents() {
  let currentDelivId = null;

  async function loadDelivList() {
    const el = document.getElementById("delivList");
    try {
      const items = await listDeliverables();
      if (!items.length) { el.innerHTML = `<p class="muted">Sin deliverables. Crea el primero.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>Nombre</th><th>Status</th><th>Kanban</th><th></th></tr></thead><tbody>
        ${items.map((d) => `<tr>
          <td>${escapeHtml(d.name)}</td>
          <td>
            <select data-status-id="${escapeHtml(d.id)}" style="font-size:11px;padding:2px 4px;border-radius:4px;background:${DELIV_STATUS_COLORS[d.status] || "rgba(255,255,255,.12)"};color:#fff;border:none;">
              ${Object.keys(DELIVERABLE_STATUS).map((k) => `<option value="${escapeHtml(DELIVERABLE_STATUS[k])}" ${d.status === DELIVERABLE_STATUS[k] ? "selected" : ""}>${escapeHtml(k.replace(/_/g, " "))}</option>`).join("")}
            </select>
          </td>
          <td><button class="btn btn-ghost btn-xs" data-open-kanban="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}">Ver Kanban</button></td>
          <td><button class="btn btn-danger btn-xs" data-del-deliv="${escapeHtml(d.id)}">✕</button></td>
        </tr>`).join("")}
      </tbody></table>`;

      el.querySelectorAll("[data-status-id]").forEach((sel) => {
        sel.addEventListener("change", async () => {
          try { await updateDeliverable(sel.dataset.statusId, { status: sel.value }); sel.style.background = DELIV_STATUS_COLORS[sel.value] || "rgba(255,255,255,.12)"; }
          catch (e) { alert(e.message); }
        });
      });

      el.querySelectorAll("[data-open-kanban]").forEach((btn) => {
        btn.addEventListener("click", () => openKanban(btn.dataset.openKanban, btn.dataset.name));
      });

      el.querySelectorAll("[data-del-deliv]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar deliverable y todas sus tareas?")) return;
          try { await removeDeliverable(btn.dataset.delDeliv); await loadDelivList(); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  async function openKanban(delivId, name) {
    currentDelivId = delivId;
    document.getElementById("delivList").style.display = "none";
    document.getElementById("kanbanView").style.display = "block";
    document.getElementById("kanbanTitle").textContent = name;
    await renderKanban(delivId);
  }

  async function renderKanban(delivId) {
    const board = document.getElementById("kanbanBoard");
    board.innerHTML = `<div class="muted" style="grid-column:1/-1;">Cargando…</div>`;
    try {
      const allItems = await listItems(delivId);
      board.innerHTML = STAGE_NAMES.map((stage) => {
        const stageItems = allItems.filter((i) => i.stage_name === stage);
        return `
          <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:10px;min-height:120px;">
            <div style="font-size:11px;font-weight:700;margin-bottom:8px;opacity:.7;">${STAGE_LABELS[stage]}</div>
            ${stageItems.map((item) => `
              <div style="background:rgba(255,255,255,.08);border-radius:6px;padding:8px;margin-bottom:6px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;">
                  <span>${escapeHtml(item.title)}</span>
                  <button class="btn btn-danger btn-xs" data-del-item="${escapeHtml(item.id)}" style="flex-shrink:0;padding:1px 4px;font-size:10px;">✕</button>
                </div>
                <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                  ${["todo","doing","done"].map((st) => `
                    <button data-move="${escapeHtml(item.id)}" data-stage="${stage}" data-status="${st}"
                      style="padding:2px 6px;border-radius:4px;font-size:10px;border:none;cursor:pointer;
                             background:${item.status === st ? STATUS_COLORS[st] : "rgba(255,255,255,.1)"};
                             color:#fff;font-weight:${item.status === st ? "700" : "400"};">
                      ${st}
                    </button>`).join("")}
                </div>
              </div>`).join("")}
          </div>`;
      }).join("");

      board.querySelectorAll("[data-del-item]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try { await removeKanbanItem(btn.dataset.delItem); await renderKanban(delivId); } catch (e) { alert(e.message); }
        });
      });

      board.querySelectorAll("[data-move]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try { await updateKanbanItem(btn.dataset.move, { status: btn.dataset.status }); await renderKanban(delivId); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { board.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  document.getElementById("btnCloseKanban")?.addEventListener("click", () => {
    document.getElementById("kanbanView").style.display = "none";
    document.getElementById("delivList").style.display = "block";
    currentDelivId = null;
  });

  document.getElementById("kanbanAddItem")?.addEventListener("click", async () => {
    if (!currentDelivId) return;
    const stage = document.getElementById("kanbanStageAdd").value;
    const title = document.getElementById("kanbanItemTitle").value.trim();
    if (!title) { alert("Escribe el título de la tarea."); return; }
    try {
      await addKanbanItem({ deliverable_id: currentDelivId, stage_name: stage, title });
      document.getElementById("kanbanItemTitle").value = "";
      await renderKanban(currentDelivId);
    } catch (e) { alert(e.message); }
  });

  // ── Modal nuevo deliverable ──
  const backdrop = document.getElementById("delivModalBackdrop");
  document.getElementById("btnAddDeliv")?.addEventListener("click", () => { backdrop.style.display = "flex"; });
  document.getElementById("delivCancel")?.addEventListener("click", () => { backdrop.style.display = "none"; });
  document.getElementById("delivSave")?.addEventListener("click", async () => {
    const name = document.getElementById("delivName").value.trim();
    const specsRaw = document.getElementById("delivSpecs").value.trim();
    const errEl = document.getElementById("delivErr");
    if (!name) { errEl.textContent = "El nombre es requerido."; errEl.style.display = "block"; return; }
    let specs = {};
    if (specsRaw) {
      try { specs = JSON.parse(specsRaw); } catch { errEl.textContent = "Specs JSON inválido."; errEl.style.display = "block"; return; }
    }
    errEl.style.display = "none";
    const btn = document.getElementById("delivSave"); btn.disabled = true;
    try {
      await createDeliverable({ name, specs });
      backdrop.style.display = "none";
      document.getElementById("delivName").value = "";
      document.getElementById("delivSpecs").value = "";
      await loadDelivList();
    } catch (e) { errEl.textContent = e.message; errEl.style.display = "block"; }
    finally { btn.disabled = false; }
  });

  await loadDelivList();
}
