// src/modules/recursos.js
// Módulo: Recursos — tabs: Crew, Locaciones, Gear
import { list as listCrew, create as createCrew, remove as removeCrew } from "../services/crewService.js";
import { list as listLoc, create as createLoc, remove as removeLoc } from "../services/locationsService.js";
import { list as listGear, create as createGear, remove as removeGear } from "../services/gearService.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}
function money(n) {
  return Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function renderRecursosView() {
  return `
<div class="container" style="padding-top:16px;">
  <div class="card" style="padding:0;">
    <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,.1);">
      <button class="res-tab tab-active" data-tab="crew"      style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;color:inherit;font-weight:700;border-bottom:2px solid var(--primary);">Crew</button>
      <button class="res-tab"            data-tab="locaciones" style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;color:inherit;font-weight:600;opacity:.7;">Locaciones</button>
      <button class="res-tab"            data-tab="gear"       style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;color:inherit;font-weight:600;opacity:.7;">Gear</button>
    </div>
    <div style="padding:18px;">

      <!-- ── CREW ── -->
      <div id="tab-crew">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h2 style="margin:0;">Equipo / Crew</h2>
          <button class="btn btn-primary btn-xs" id="btnAddCrew">+ Agregar</button>
        </div>
        <div id="crewList"><div class="muted">Cargando…</div></div>
        <div id="crewModalBackdrop" class="modal-backdrop" style="display:none;">
          <div class="modal" style="max-width:460px;">
            <div class="modal-header"><h3>Agregar integrante</h3></div>
            <div class="modal-body">
              <div class="form-grid">
                <label style="grid-column:1/-1;">Nombre *<input id="crewName" type="text" /></label>
                <label style="grid-column:1/-1;">Rol / Puesto *<input id="crewRole" type="text" /></label>
                <label>Tarifa / día<input id="crewRate" type="number" min="0" step="0.01" /></label>
                <label>Teléfono<input id="crewPhone" type="tel" /></label>
                <label style="grid-column:1/-1;">Email<input id="crewEmail" type="email" /></label>
                <label style="grid-column:1/-1;">Notas<textarea id="crewNotes" rows="2"></textarea></label>
              </div>
              <p id="crewErr" class="error" style="display:none;"></p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="crewCancel">Cancelar</button>
              <button class="btn btn-primary" id="crewSave">Guardar</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── LOCACIONES ── -->
      <div id="tab-locaciones" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h2 style="margin:0;">Locaciones</h2>
          <button class="btn btn-primary btn-xs" id="btnAddLoc">+ Agregar</button>
        </div>
        <div id="locList"><div class="muted">Cargando…</div></div>
        <div id="locModalBackdrop" class="modal-backdrop" style="display:none;">
          <div class="modal" style="max-width:480px;">
            <div class="modal-header"><h3>Agregar locación</h3></div>
            <div class="modal-body">
              <div class="form-grid">
                <label style="grid-column:1/-1;">Nombre *<input id="locName" type="text" /></label>
                <label style="grid-column:1/-1;">Dirección<input id="locAddress" type="text" /></label>
                <label>Contacto<input id="locContact" type="text" /></label>
                <label>Teléfono<input id="locPhone" type="tel" /></label>
                <label style="grid-column:1/-1;">Restricciones<textarea id="locRestrictions" rows="2"></textarea></label>
                <label style="grid-column:1/-1;">Notas<textarea id="locNotes" rows="2"></textarea></label>
              </div>
              <p id="locErr" class="error" style="display:none;"></p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="locCancel">Cancelar</button>
              <button class="btn btn-primary" id="locSave">Guardar</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── GEAR ── -->
      <div id="tab-gear" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h2 style="margin:0;">Equipamiento</h2>
          <button class="btn btn-primary btn-xs" id="btnAddGear">+ Agregar</button>
        </div>
        <div id="gearList"><div class="muted">Cargando…</div></div>
        <div id="gearModalBackdrop" class="modal-backdrop" style="display:none;">
          <div class="modal" style="max-width:460px;">
            <div class="modal-header"><h3>Agregar equipo</h3></div>
            <div class="modal-body">
              <div class="form-grid">
                <label style="grid-column:1/-1;">Nombre *<input id="gearName" type="text" /></label>
                <label>Tipo<input id="gearType" type="text" placeholder="camera, audio, lens…" /></label>
                <label>Origen
                  <select id="gearOwner"><option value="owned">Propio</option><option value="rented">Renta</option></select>
                </label>
                <label style="grid-column:1/-1;">Proveedor<input id="gearVendor" type="text" /></label>
                <label>Costo / día<input id="gearCost" type="number" min="0" step="0.01" /></label>
                <label style="grid-column:1/-1;">Notas<textarea id="gearNotes" rows="2"></textarea></label>
              </div>
              <p id="gearErr" class="error" style="display:none;"></p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="gearCancel">Cancelar</button>
              <button class="btn btn-primary" id="gearSave">Guardar</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>`;
}

export async function bindRecursosEvents() {
  // ── Tabs ──
  const tabBtns = document.querySelectorAll(".res-tab");
  const tabs = { crew: document.getElementById("tab-crew"), locaciones: document.getElementById("tab-locaciones"), gear: document.getElementById("tab-gear") };
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => { b.classList.remove("tab-active"); b.style.opacity = ".7"; b.style.borderBottom = "none"; b.style.fontWeight = "600"; });
      btn.classList.add("tab-active"); btn.style.opacity = "1"; btn.style.borderBottom = "2px solid var(--primary)"; btn.style.fontWeight = "700";
      Object.values(tabs).forEach((t) => { if (t) t.style.display = "none"; });
      const t = tabs[btn.dataset.tab];
      if (t) t.style.display = "block";
    });
  });

  // ── CREW ──
  async function loadCrew() {
    const el = document.getElementById("crewList");
    try {
      const items = await listCrew();
      if (!items.length) { el.innerHTML = `<p class="muted">Sin integrantes. Agrega el primero.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>Nombre</th><th>Rol</th><th>Tarifa/día</th><th>Teléfono</th><th></th></tr></thead><tbody>
        ${items.map((c) => `<tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.role_name)}</td>
          <td>${c.rate ? money(c.rate) : "—"}</td>
          <td>${c.phone ? escapeHtml(c.phone) : "—"}</td>
          <td><button class="btn btn-danger btn-xs" data-del-crew="${escapeHtml(c.id)}">✕</button></td>
        </tr>`).join("")}
      </tbody></table>`;
      el.querySelectorAll("[data-del-crew]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar?")) return;
          try { await removeCrew(btn.dataset.delCrew); await loadCrew(); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }
  await loadCrew();

  function bindModal({ backdropId, openBtnId, cancelId, saveId, errId, getData, serviceCreate, reload }) {
    const backdrop = document.getElementById(backdropId);
    document.getElementById(openBtnId)?.addEventListener("click", () => { backdrop.style.display = "flex"; });
    document.getElementById(cancelId)?.addEventListener("click", () => { backdrop.style.display = "none"; });
    document.getElementById(saveId)?.addEventListener("click", async () => {
      const errEl = document.getElementById(errId);
      errEl.style.display = "none";
      const btn = document.getElementById(saveId); btn.disabled = true;
      try {
        const data = getData();
        await serviceCreate(data);
        backdrop.style.display = "none";
        await reload();
      } catch (e) { errEl.textContent = e.message; errEl.style.display = "block"; }
      finally { btn.disabled = false; }
    });
  }

  bindModal({
    backdropId: "crewModalBackdrop", openBtnId: "btnAddCrew", cancelId: "crewCancel", saveId: "crewSave", errId: "crewErr",
    getData: () => ({
      name: document.getElementById("crewName").value,
      role_name: document.getElementById("crewRole").value,
      rate: parseFloat(document.getElementById("crewRate").value) || null,
      phone: document.getElementById("crewPhone").value || null,
      email: document.getElementById("crewEmail").value || null,
      notes: document.getElementById("crewNotes").value || null,
    }),
    serviceCreate: createCrew,
    reload: loadCrew,
  });

  // ── LOCACIONES ──
  async function loadLoc() {
    const el = document.getElementById("locList");
    try {
      const items = await listLoc();
      if (!items.length) { el.innerHTML = `<p class="muted">Sin locaciones.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>Nombre</th><th>Dirección</th><th>Contacto</th><th></th></tr></thead><tbody>
        ${items.map((l) => `<tr>
          <td>${escapeHtml(l.name)}</td>
          <td>${l.address ? escapeHtml(l.address) : "—"}</td>
          <td>${l.contact_name ? escapeHtml(l.contact_name) : "—"}</td>
          <td><button class="btn btn-danger btn-xs" data-del-loc="${escapeHtml(l.id)}">✕</button></td>
        </tr>`).join("")}
      </tbody></table>`;
      el.querySelectorAll("[data-del-loc]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar?")) return;
          try { await removeLoc(btn.dataset.delLoc); await loadLoc(); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  tabBtns.forEach((b) => { if (b.dataset.tab === "locaciones") b.addEventListener("click", loadLoc); });
  bindModal({
    backdropId: "locModalBackdrop", openBtnId: "btnAddLoc", cancelId: "locCancel", saveId: "locSave", errId: "locErr",
    getData: () => ({
      name: document.getElementById("locName").value,
      address: document.getElementById("locAddress").value || null,
      contact_name: document.getElementById("locContact").value || null,
      contact_phone: document.getElementById("locPhone").value || null,
      restrictions: document.getElementById("locRestrictions").value || null,
      notes: document.getElementById("locNotes").value || null,
    }),
    serviceCreate: createLoc,
    reload: loadLoc,
  });

  // ── GEAR ──
  async function loadGear() {
    const el = document.getElementById("gearList");
    try {
      const items = await listGear();
      if (!items.length) { el.innerHTML = `<p class="muted">Sin equipamiento.</p>`; return; }
      el.innerHTML = `<table class="table"><thead><tr><th>Nombre</th><th>Tipo</th><th>Origen</th><th>Costo/día</th><th></th></tr></thead><tbody>
        ${items.map((g) => `<tr>
          <td>${escapeHtml(g.name)}</td>
          <td>${g.type ? escapeHtml(g.type) : "—"}</td>
          <td>${g.owner_type === "rented" ? "Renta" : "Propio"}</td>
          <td>${g.cost_per_day ? money(g.cost_per_day) : "—"}</td>
          <td><button class="btn btn-danger btn-xs" data-del-gear="${escapeHtml(g.id)}">✕</button></td>
        </tr>`).join("")}
      </tbody></table>`;
      el.querySelectorAll("[data-del-gear]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar?")) return;
          try { await removeGear(btn.dataset.delGear); await loadGear(); } catch (e) { alert(e.message); }
        });
      });
    } catch (e) { el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`; }
  }

  tabBtns.forEach((b) => { if (b.dataset.tab === "gear") b.addEventListener("click", loadGear); });
  bindModal({
    backdropId: "gearModalBackdrop", openBtnId: "btnAddGear", cancelId: "gearCancel", saveId: "gearSave", errId: "gearErr",
    getData: () => ({
      name: document.getElementById("gearName").value,
      type: document.getElementById("gearType").value || null,
      owner_type: document.getElementById("gearOwner").value,
      vendor: document.getElementById("gearVendor").value || null,
      cost_per_day: parseFloat(document.getElementById("gearCost").value) || null,
      notes: document.getElementById("gearNotes").value || null,
    }),
    serviceCreate: createGear,
    reload: loadGear,
  });
}
