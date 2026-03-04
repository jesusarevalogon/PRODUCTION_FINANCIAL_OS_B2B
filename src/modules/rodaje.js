// src/modules/rodaje.js
// Módulo: Rodaje — tabs: Schedule, Call Sheets, DPR
import {
  listDays, createDay, removeDay,
  listScenes, createScene, addSceneToDay, removeSceneFromDay,
} from "../services/scheduleService.js";
import {
  list as listCS, get as getCS, create as createCS,
  publish as publishCS, updateStatus as updateCSStatus, remove as removeCS,
} from "../services/callSheetsService.js";
import { getByDay, upsert as upsertDPR, list as listDPR } from "../services/dailyReportsService.js";
import { list as listLocations } from "../services/locationsService.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}
function fmt(d) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" }) : "";
}

// ── Resize de imagen móvil (cámara) ──────────────────────
async function resizeImage(file, maxPx = 1600, quality = 0.75) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round((height * maxPx) / width); width = maxPx; }
        else                { width  = Math.round((width  * maxPx) / height); height = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(new File([blob], file.name, { type: "image/jpeg" })), "image/jpeg", quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

export function renderRodajeView() {
  return `
<div class="container" style="padding-top:16px;">
  <div class="card" style="margin-bottom:0;padding:0 0 0 0;">
    <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,.1);">
      <button class="tab-btn tab-active" data-tab="schedule"  style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;color:inherit;font-weight:700;border-bottom:2px solid var(--primary);">Schedule</button>
      <button class="tab-btn"            data-tab="callsheets" style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;color:inherit;font-weight:600;opacity:.7;">Call Sheets</button>
      <button class="tab-btn"            data-tab="dpr"        style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;color:inherit;font-weight:600;opacity:.7;">DPR</button>
    </div>
    <div style="padding:18px;">

      <!-- ── SCHEDULE ── -->
      <div id="tab-schedule">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h2 style="margin:0;">Días de Rodaje</h2>
          <button class="btn btn-primary btn-xs" id="btnAddDay">+ Agregar día</button>
        </div>
        <div id="scheduleList"><div class="muted">Cargando…</div></div>

        <!-- Modal agregar día -->
        <div id="dayModalBackdrop" class="modal-backdrop" style="display:none;">
          <div class="modal" style="max-width:480px;">
            <div class="modal-header"><h3>Agregar día de rodaje</h3></div>
            <div class="modal-body">
              <div class="form-grid">
                <label style="grid-column:1/-1;">Fecha *<input id="dayDate" type="date" /></label>
                <label>Unidad
                  <select id="dayUnit"><option>A</option><option>B</option><option>C</option></select>
                </label>
                <label>Call time<input id="dayCallTime" type="time" /></label>
                <label style="grid-column:1/-1;">Locación
                  <select id="dayLocation"><option value="">— Sin locación —</option></select>
                </label>
                <label style="grid-column:1/-1;">Notas<textarea id="dayNotes" rows="2"></textarea></label>
              </div>
              <p id="dayErr" class="error" style="display:none;"></p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="dayCancel">Cancelar</button>
              <button class="btn btn-primary" id="daySave">Guardar</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── CALL SHEETS ── -->
      <div id="tab-callsheets" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h2 style="margin:0;">Call Sheets</h2>
          <button class="btn btn-primary btn-xs" id="btnAddCS">+ Nuevo Call Sheet</button>
        </div>
        <div id="csList"><div class="muted">Cargando…</div></div>

        <!-- Modal nuevo CS -->
        <div id="csModalBackdrop" class="modal-backdrop" style="display:none;">
          <div class="modal" style="max-width:420px;">
            <div class="modal-header"><h3>Nuevo Call Sheet</h3></div>
            <div class="modal-body">
              <label>Día de rodaje *
                <select id="csDaySelect"><option value="">— Selecciona un día —</option></select>
              </label>
              <p id="csErr" class="error" style="display:none;"></p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="csCancel">Cancelar</button>
              <button class="btn btn-primary" id="csSave">Crear</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── DPR ── -->
      <div id="tab-dpr" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h2 style="margin:0;">Daily Production Reports</h2>
          <select id="dprDaySelect" style="max-width:260px;"><option value="">— Selecciona un día —</option></select>
        </div>
        <div id="dprForm" style="display:none;">
          <div class="form-grid" style="max-width:640px;">
            <label style="grid-column:1/-1;">Resumen del día
              <textarea id="dprSummary" rows="3"></textarea>
            </label>
            <label>Escenas filmadas<input id="dprScenes" type="text" placeholder="Ej. 12A, 14B, 15" /></label>
            <label>Páginas filmadas<input id="dprPages"  type="text" placeholder="Ej. 4 2/8" /></label>
            <label style="grid-column:1/-1;">Incidencias / notas
              <textarea id="dprNotes" rows="2"></textarea>
            </label>
            <!-- Subir foto desde cámara (móvil) -->
            <div style="grid-column:1/-1;">
              <span style="font-size:12px;font-weight:600;">Foto del set</span>
              <input id="dprCameraInput" type="file" accept="image/*" capture="environment" style="display:none;" />
              <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
                <button class="btn btn-ghost btn-xs" type="button" id="dprBtnCamera">📷 Tomar foto</button>
                <span id="dprPhotoName" class="muted" style="font-size:11px;"></span>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;">
            <button class="btn btn-primary" id="dprSaveBtn">Guardar DPR</button>
            <span id="dprMsg" class="muted" style="font-size:12px;line-height:32px;"></span>
          </div>
        </div>
        <p id="dprSelectMsg" class="muted">Selecciona un día para ver o editar el reporte.</p>
      </div>

    </div>
  </div>
</div>`;
}

export async function bindRodajeEvents() {
  // ── Tab switching ──
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabs = { schedule: document.getElementById("tab-schedule"), callsheets: document.getElementById("tab-callsheets"), dpr: document.getElementById("tab-dpr") };
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => { b.classList.remove("tab-active"); b.style.opacity = ".7"; b.style.borderBottom = "none"; b.style.fontWeight = "600"; });
      btn.classList.add("tab-active"); btn.style.opacity = "1"; btn.style.borderBottom = "2px solid var(--primary)"; btn.style.fontWeight = "700";
      Object.values(tabs).forEach((t) => { if (t) t.style.display = "none"; });
      const t = tabs[btn.dataset.tab];
      if (t) t.style.display = "block";
    });
  });

  // ── Load data ──
  let allDays = [];
  let allLocations = [];

  async function loadDays() {
    try {
      allDays = await listDays();
      renderDaysList(allDays);
      populateDaySelects(allDays);
    } catch (e) {
      document.getElementById("scheduleList").innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    }
  }

  async function loadLocations() {
    try { allLocations = await listLocations(); } catch { allLocations = []; }
  }

  function renderDaysList(days) {
    const el = document.getElementById("scheduleList");
    if (!days.length) { el.innerHTML = `<p class="muted">No hay días de rodaje. Crea el primero.</p>`; return; }
    el.innerHTML = `<table class="table"><thead><tr><th>Fecha</th><th>Unidad</th><th>Call</th><th>Locación</th><th>Escenas</th><th></th></tr></thead><tbody>
      ${days.map((d) => `
        <tr>
          <td>${escapeHtml(fmt(d.shoot_date))}</td>
          <td>${escapeHtml(d.unit)}</td>
          <td>${d.call_time ? escapeHtml(d.call_time.slice(0,5)) : "—"}</td>
          <td>${d.primary_location ? escapeHtml(d.primary_location.name) : "—"}</td>
          <td>${(d.scenes || []).length}</td>
          <td><button class="btn btn-danger btn-xs" data-delete-day="${escapeHtml(d.id)}">✕</button></td>
        </tr>`).join("")}
    </tbody></table>`;
    el.querySelectorAll("[data-delete-day]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este día de rodaje?")) return;
        try { await removeDay(btn.dataset.deleteDay); await loadDays(); } catch (e) { alert(e.message); }
      });
    });
  }

  function populateDaySelects(days) {
    const csSel = document.getElementById("csDaySelect");
    const dprSel = document.getElementById("dprDaySelect");
    const opts = days.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(fmt(d.shoot_date))} — Unidad ${escapeHtml(d.unit)}</option>`).join("");
    if (csSel) csSel.innerHTML = `<option value="">— Selecciona un día —</option>${opts}`;
    if (dprSel) dprSel.innerHTML = `<option value="">— Selecciona un día —</option>${opts}`;
  }

  await Promise.all([loadDays(), loadLocations()]);

  // ── Populate location select ──
  const locSel = document.getElementById("dayLocation");
  if (locSel) {
    locSel.innerHTML = `<option value="">— Sin locación —</option>` +
      allLocations.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join("");
  }

  // ── Add Day modal ──
  const backdrop = document.getElementById("dayModalBackdrop");
  document.getElementById("btnAddDay")?.addEventListener("click", () => { backdrop.style.display = "flex"; });
  document.getElementById("dayCancel")?.addEventListener("click", () => { backdrop.style.display = "none"; });
  document.getElementById("daySave")?.addEventListener("click", async () => {
    const shoot_date = document.getElementById("dayDate").value;
    const unit       = document.getElementById("dayUnit").value;
    const call_time  = document.getElementById("dayCallTime").value || null;
    const primary_location_id = document.getElementById("dayLocation").value || null;
    const notes      = document.getElementById("dayNotes").value || null;
    const errEl      = document.getElementById("dayErr");
    if (!shoot_date) { errEl.textContent = "La fecha es requerida."; errEl.style.display = "block"; return; }
    errEl.style.display = "none";
    const btn = document.getElementById("daySave"); btn.disabled = true;
    try {
      await createDay({ shoot_date, unit, call_time, primary_location_id, notes });
      backdrop.style.display = "none";
      await loadDays();
    } catch (e) { errEl.textContent = e.message; errEl.style.display = "block"; }
    finally { btn.disabled = false; }
  });

  // ── Load Call Sheets ──
  async function loadCSList() {
    const el = document.getElementById("csList");
    try {
      const sheets = await listCS();
      if (!sheets.length) { el.innerHTML = `<p class="muted">No hay call sheets.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>Fecha</th><th>Unidad</th><th>Status</th><th>Versión</th><th></th></tr></thead><tbody>
        ${sheets.map((cs) => `
          <tr>
            <td>${escapeHtml(fmt(cs.schedule_day?.shoot_date))}</td>
            <td>${escapeHtml(cs.schedule_day?.unit || "")}</td>
            <td><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${cs.status === "published" ? "#38c172" : cs.status === "review" ? "#f4b740" : "rgba(255,255,255,.12)"};">${escapeHtml(cs.status)}</span></td>
            <td>v${cs.current_version || 0}</td>
            <td style="display:flex;gap:6px;">
              ${cs.status !== "published" ? `<button class="btn btn-primary btn-xs" data-publish="${escapeHtml(cs.id)}">Publicar</button>` : `<button class="btn btn-ghost btn-xs" data-publish="${escapeHtml(cs.id)}">Re-publicar</button>`}
              <button class="btn btn-danger btn-xs" data-delete-cs="${escapeHtml(cs.id)}">✕</button>
            </td>
          </tr>`).join("")}
      </tbody></table>`;
      el.querySelectorAll("[data-publish]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const result = await publishCS(btn.dataset.publish);
            alert(`Publicado como versión ${result?.version_number ?? "nueva"}.`);
            await loadCSList();
          } catch (e) { alert(e.message); btn.disabled = false; }
        });
      });
      el.querySelectorAll("[data-delete-cs]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar este call sheet?")) return;
          try { await removeCS(btn.dataset.deleteCs); await loadCSList(); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  // Load CS when tab is clicked
  tabBtns.forEach((btn) => {
    if (btn.dataset.tab === "callsheets") btn.addEventListener("click", loadCSList);
  });

  // ── New CS modal ──
  const csBackdrop = document.getElementById("csModalBackdrop");
  document.getElementById("btnAddCS")?.addEventListener("click", () => { loadCSList(); csBackdrop.style.display = "flex"; });
  document.getElementById("csCancel")?.addEventListener("click", () => { csBackdrop.style.display = "none"; });
  document.getElementById("csSave")?.addEventListener("click", async () => {
    const schedule_day_id = document.getElementById("csDaySelect").value;
    const errEl = document.getElementById("csErr");
    if (!schedule_day_id) { errEl.textContent = "Selecciona un día."; errEl.style.display = "block"; return; }
    errEl.style.display = "none";
    const btn = document.getElementById("csSave"); btn.disabled = true;
    try {
      await createCS({ schedule_day_id });
      csBackdrop.style.display = "none";
      await loadCSList();
    } catch (e) { errEl.textContent = e.message; errEl.style.display = "block"; }
    finally { btn.disabled = false; }
  });

  // ── DPR ──
  let dprPhotoFile = null;
  const dprCameraInput = document.getElementById("dprCameraInput");
  document.getElementById("dprBtnCamera")?.addEventListener("click", () => dprCameraInput?.click());
  dprCameraInput?.addEventListener("change", async () => {
    const file = dprCameraInput.files?.[0];
    if (!file) return;
    dprPhotoFile = file.type.startsWith("image/") ? await resizeImage(file) : file;
    document.getElementById("dprPhotoName").textContent = dprPhotoFile.name;
  });

  document.getElementById("dprDaySelect")?.addEventListener("change", async (e) => {
    const dayId = e.target.value;
    const formEl = document.getElementById("dprForm");
    const msgEl  = document.getElementById("dprSelectMsg");
    if (!dayId) { if (formEl) formEl.style.display = "none"; if (msgEl) msgEl.style.display = "block"; return; }
    if (msgEl) msgEl.style.display = "none";
    if (formEl) formEl.style.display = "block";
    try {
      const report = await getByDay(dayId);
      if (report?.content) {
        const c = report.content;
        document.getElementById("dprSummary").value = c.summary || "";
        document.getElementById("dprScenes").value  = c.scenes  || "";
        document.getElementById("dprPages").value   = c.pages   || "";
        document.getElementById("dprNotes").value   = c.notes   || "";
      } else {
        ["dprSummary","dprScenes","dprPages","dprNotes"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
      }
    } catch { /* ignore — nuevo DPR */ }
  });

  document.getElementById("dprSaveBtn")?.addEventListener("click", async () => {
    const dayId   = document.getElementById("dprDaySelect").value;
    const msgEl   = document.getElementById("dprMsg");
    if (!dayId) { msgEl.textContent = "Selecciona un día."; return; }
    const content = {
      summary: document.getElementById("dprSummary").value,
      scenes:  document.getElementById("dprScenes").value,
      pages:   document.getElementById("dprPages").value,
      notes:   document.getElementById("dprNotes").value,
    };
    const btn = document.getElementById("dprSaveBtn"); btn.disabled = true;
    msgEl.textContent = "Guardando…";
    try {
      await upsertDPR({ schedule_day_id: dayId, content });
      msgEl.textContent = "✓ Guardado";
      setTimeout(() => { msgEl.textContent = ""; }, 2500);
    } catch (e) { msgEl.textContent = e.message; }
    finally { btn.disabled = false; }
  });
}
