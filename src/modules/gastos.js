/* =========================================================
   src/modules/gastos.js
   Registro y seguimiento de gastos reales de producción.

   ✅ Requiere proyecto activo
   ✅ Alta de gasto: fecha, cuenta, concepto, monto, proveedor, responsable
   ✅ Vinculación opcional a partida del presupuesto (budget_item_uid)
   ✅ Upload de comprobante (ticket/factura) a Supabase Storage
   ✅ Tabla con filtros por cuenta y búsqueda
   ✅ Eliminar gastos
   ✅ Total acumulado visible
   ✅ Cuentas del presupuesto cargadas dinámicamente
========================================================= */

import { getExpenses, createExpense, deleteExpense } from "../services/gastosService.js";
import { loadModuleState } from "../services/stateService.js";
import { buildStoragePath, uploadFile, createSignedUrl } from "../services/storageService.js";
import { maybeCompressPdfFile } from "../services/pdfCompressService.js";
import { STORAGE_BUCKET, COMPROBANTE_MAX_MB } from "../utils/constants.js";

const CUENTAS_DEFAULT = [
  "DESARROLLO",
  "PREPRODUCCIÓN",
  "PERSONAL DE DIRECCIÓN",
  "PERSONAL DE CÁMARA",
  "PERSONAL DE ARTE",
  "PERSONAL DE SONIDO",
  "PERSONAL DE DATA MANAGER",
  "PERSONAL FOTO FIJA Y MAKING OF",
  "REPARTO",
  "EQUIPO DE CÁMARA",
  "EQUIPO DE SONIDO",
  "GASTOS DE DISEÑO DE PRODUCCIÓN",
  "LOCACIONES",
  "TRANSPORTE RODAJE",
  "ALIMENTACIÓN",
  "HOSPEDAJE",
  "GASTOS EXTRA DE PRODUCCIÓN",
  "GASTOS CONTABLES",
  "GASTOS LEGALES",
  "EDICIÓN",
  "POSTPRODUCCIÓN DE SONIDO",
  "POSTPRODUCCIÓN DE IMAGEN",
  "CRÉDITOS",
  "SUBTÍTULOS",
  "PRESS KIT",
  "DELIVERIES",
  "RESGUARDO Y PROMOCIÓN IMCINE",
  "PÓLIZA DE SEGURO",
  "CIERRE ADMINISTRATIVO",
];

// Carga cuentas desde el presupuesto activo
async function loadCuentasFromBudget() {
  try {
    const userId = window?.appState?.user?.id;
    const projectId = window?.appState?.project?.id;
    if (!userId || !projectId) return null;

    const state = await loadModuleState({ userId, projectId, moduleKey: "presupuesto" });
    const items = Array.isArray(state?.items) ? state.items : [];
    if (!items.length) return null;

    const cuentas = [...new Set(items.map(i => String(i.cuenta || "").trim()).filter(Boolean))];
    return cuentas.length ? cuentas : null;
  } catch {
    return null;
  }
}

// Carga partidas del presupuesto activo para el selector
async function loadPartidasFromBudget() {
  try {
    const userId = window?.appState?.user?.id;
    const projectId = window?.appState?.project?.id;
    if (!userId || !projectId) return [];

    const state = await loadModuleState({ userId, projectId, moduleKey: "presupuesto" });
    return Array.isArray(state?.items) ? state.items : [];
  } catch {
    return [];
  }
}

// ─── RENDER ───────────────────────────────────────────────
export function renderGastosView() {
  return `
    <div class="container" style="padding-top:18px;" id="gastosRoot">

      <!-- Header + resumen -->
      <div class="card" style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;">Gastos</h2>
            <p class="muted" style="margin:4px 0 0;" id="gastosProyNombre">Proyecto activo: cargando…</p>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <div id="gastosTotalWrap" style="text-align:right;">
              <div class="muted" style="font-size:11px;">TOTAL EJECUTADO</div>
              <div id="gastosTotal" style="font-size:20px;font-weight:700;color:var(--primary);">$0.00</div>
            </div>
            <button id="gastoBtnNuevo" class="btn btn-primary">+ Agregar gasto</button>
          </div>
        </div>
      </div>

      <!-- Mensaje -->
      <div id="gastosMsg" style="display:none;margin-bottom:12px;"></div>

      <!-- Filtros -->
      <div class="card" style="margin-bottom:14px;padding:14px 18px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <input id="gastosSearch" type="text" placeholder="Buscar concepto, proveedor, responsable…"
                 style="flex:1;min-width:200px;" />
          <select id="gastosFilterCuenta" style="min-width:200px;">
            <option value="">Todas las cuentas</option>
          </select>
          <button id="gastosBtnClearFilter" class="btn btn-ghost btn-xs">Limpiar filtros</button>
        </div>
      </div>

      <!-- Tabla -->
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-wrap" style="border:none;">
          <table class="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cuenta</th>
                <th>Concepto</th>
                <th>Proveedor</th>
                <th>Responsable</th>
                <th style="text-align:right;">Monto</th>
                <th style="text-align:center;">Comp.</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="gastosTbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Modal nuevo gasto -->
      <div id="gastosModalBackdrop" class="modal-backdrop" style="display:none;">
        <div class="modal" style="max-width:560px;">
          <div class="modal-header">
            <h3>Agregar gasto</h3>
            <button id="gastosModalClose" class="modal-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <label>
                <span>Fecha *</span>
                <input id="gastoFecha" type="date" />
              </label>
              <label>
                <span>Cuenta *</span>
                <select id="gastoCuenta"></select>
              </label>

              <label style="grid-column:1/-1;">
                <span>Partida de presupuesto (opcional)</span>
                <select id="gastoPartida">
                  <option value="">— Sin vincular —</option>
                </select>
              </label>

              <label style="grid-column:1/-1;">
                <span>Concepto</span>
                <input id="gastoConcepto" type="text" placeholder="Descripción del gasto" />
              </label>
              <label>
                <span>Monto *</span>
                <input id="gastoMonto" type="number" min="0.01" step="0.01" placeholder="0.00" />
              </label>
              <label>
                <span>Proveedor</span>
                <input id="gastoProveedor" type="text" placeholder="Empresa o persona" />
              </label>
              <label style="grid-column:1/-1;">
                <span>Responsable</span>
                <input id="gastoResponsable" type="text" placeholder="Nombre del responsable" />
              </label>

              <div style="grid-column:1/-1;">
                <span style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Comprobante <span class="muted" style="font-weight:400;font-size:11px;">(PDF, imagen — máx. 10MB)</span></span>
                <!-- inputs ocultos -->
                <input id="gastoReceiptCamera" type="file" accept="image/*" capture="environment" style="display:none;" />
                <input id="gastoReceiptUpload" type="file" accept="image/*,application/pdf,image/heic,image/heif" style="display:none;" />
                <!-- botones de acción -->
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  <button type="button" id="gastoBtnCamera" class="btn btn-ghost btn-xs">📷 Tomar foto</button>
                  <button type="button" id="gastoBtnUpload" class="btn btn-ghost btn-xs">📎 Subir archivo</button>
                  <button type="button" id="gastoBtnQuitarComp" class="btn btn-danger btn-xs" style="display:none;">✕ Quitar</button>
                </div>
                <!-- preview del archivo -->
                <div id="gastoComprobantePreview" style="display:none;margin-top:8px;"></div>
                <!-- warning de upload fallido -->
                <p id="gastoUploadWarn" style="display:none;color:#f59e0b;font-size:12px;margin:4px 0 0;"></p>
              </div>
            </div>
            <p id="gastoValidMsg" class="error" style="display:none;margin-top:10px;"></p>
            <p id="gastoUploadMsg" class="muted" style="display:none;margin-top:6px;font-size:12px;"></p>
          </div>
          <div class="modal-footer">
            <button id="gastosModalCancel" class="btn btn-ghost">Cancelar</button>
            <button id="gastosModalSave" class="btn btn-primary">Guardar gasto</button>
          </div>
        </div>
      </div>

    </div>
  `;
}

// ─── BIND EVENTS ──────────────────────────────────────────
export async function bindGastosEvents() {
  // Verificar proyecto activo
  if (!window.appState?.project?.id) {
    const root = document.getElementById("gastosRoot");
    if (root) {
      root.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;">
          <h2>Sin proyecto activo</h2>
          <p class="muted">Selecciona un proyecto en la sección <b>Proyectos</b> para registrar gastos.</p>
          <button class="btn btn-primary" onclick="window.navigateTo('proyectos')">Ir a Proyectos</button>
        </div>
      `;
    }
    return;
  }

  const project = window.appState.project;

  // Actualizar nombre del proyecto
  const proyNombre = document.getElementById("gastosProyNombre");
  if (proyNombre) proyNombre.textContent = `Proyecto: ${project.name}`;

  // Referencias DOM
  const tbody          = document.getElementById("gastosTbody");
  const totalEl        = document.getElementById("gastosTotal");
  const msgEl          = document.getElementById("gastosMsg");
  const searchEl       = document.getElementById("gastosSearch");
  const filterCuenta   = document.getElementById("gastosFilterCuenta");
  const btnNuevo       = document.getElementById("gastoBtnNuevo");
  const btnClear       = document.getElementById("gastosBtnClearFilter");
  const backdrop       = document.getElementById("gastosModalBackdrop");
  const btnClose       = document.getElementById("gastosModalClose");
  const btnCancel      = document.getElementById("gastosModalCancel");
  const btnSave        = document.getElementById("gastosModalSave");
  const inpFecha       = document.getElementById("gastoFecha");
  const selCuenta      = document.getElementById("gastoCuenta");
  const selPartida     = document.getElementById("gastoPartida");
  const inpConcepto    = document.getElementById("gastoConcepto");
  const inpMonto       = document.getElementById("gastoMonto");
  const inpProveedor   = document.getElementById("gastoProveedor");
  const inpResponsable = document.getElementById("gastoResponsable");
  const inpReceiptCamera   = document.getElementById("gastoReceiptCamera");
  const inpReceiptUpload   = document.getElementById("gastoReceiptUpload");
  const btnCamera          = document.getElementById("gastoBtnCamera");
  const btnUpload          = document.getElementById("gastoBtnUpload");
  const btnQuitarComp      = document.getElementById("gastoBtnQuitarComp");
  const comprobantePreview = document.getElementById("gastoComprobantePreview");
  const uploadWarn         = document.getElementById("gastoUploadWarn");
  const validMsg           = document.getElementById("gastoValidMsg");
  const uploadMsg          = document.getElementById("gastoUploadMsg");

  let allExpenses = [];
  let cuentas = [];
  let partidas = [];
  let pendingFile = null;

  // ── helpers ──
  function showMsg(text, isError = false) {
    msgEl.style.display = "block";
    msgEl.className = isError ? "error" : "ok";
    msgEl.textContent = text;
    setTimeout(() => { msgEl.style.display = "none"; }, 4500);
  }

  function fmt(n) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: project.moneda || "MXN" }).format(n || 0);
  }

  function getCurrentFilter() {
    return {
      search: searchEl.value.trim().toLowerCase(),
      cuenta: filterCuenta.value,
    };
  }

  function applyFilters(expenses, { search, cuenta }) {
    return expenses.filter(e => {
      const matchCuenta = !cuenta || e.cuenta === cuenta;
      const matchSearch = !search || [e.concepto, e.proveedor, e.responsable, e.cuenta]
        .some(f => String(f || "").toLowerCase().includes(search));
      return matchCuenta && matchSearch;
    });
  }

  function renderTable(expenses) {
    if (!expenses.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--muted);">Sin gastos registrados.</td></tr>`;
      return;
    }

    tbody.innerHTML = expenses.map(e => `
      <tr>
        <td>${escapeHtml(e.fecha || "")}</td>
        <td><span style="font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(79,124,255,.12);color:var(--primary);">${escapeHtml(e.cuenta || "")}</span></td>
        <td>${escapeHtml(e.concepto || "—")}</td>
        <td class="muted">${escapeHtml(e.proveedor || "—")}</td>
        <td class="muted">${escapeHtml(e.responsable || "—")}</td>
        <td style="text-align:right;font-weight:600;">${fmt(e.monto)}</td>
        <td style="text-align:center;">
          ${e.comprobante_path
            ? `<button class="btn btn-light btn-xs" data-path="${escapeHtml(e.comprobante_path)}" data-name="${escapeHtml(e.comprobante_name || 'Ver')}" data-action="verComprobante" title="${escapeHtml(e.comprobante_name || 'Ver comprobante')}">📎</button>`
            : '<span class="muted" style="font-size:12px;">—</span>'
          }
        </td>
        <td style="text-align:center;">
          <button class="btn btn-danger btn-xs" data-id="${e.id}" data-action="delete">✕</button>
        </td>
      </tr>
    `).join("");

    // Bind delete
    tbody.querySelectorAll("[data-action=delete]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este gasto?")) return;
        try {
          await deleteExpense(btn.dataset.id);
          showMsg("Gasto eliminado.");
          await loadAndRender();
        } catch (e) {
          showMsg(e?.message || String(e), true);
        }
      });
    });

    // Bind ver comprobante
    tbody.querySelectorAll("[data-action=verComprobante]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const url = await createSignedUrl({ path: btn.dataset.path, bucket: STORAGE_BUCKET, expiresIn: 3600 });
          if (url) window.open(url, "_blank");
          else throw new Error("No se generó URL.");
        } catch (e) {
          alert("No se pudo abrir el comprobante: " + (e?.message || String(e)));
        }
      });
    });
  }

  async function loadAndRender() {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;color:var(--muted);">Cargando…</td></tr>`;
    try {
      allExpenses = await getExpenses();

      // Total general
      const total = allExpenses.reduce((s, e) => s + Number(e.monto || 0), 0);
      if (totalEl) totalEl.textContent = fmt(total);

      // Poblar filtro de cuentas (unión de presupuesto + gastos reales)
      const cuentasEnGastos = [...new Set(allExpenses.map(e => e.cuenta).filter(Boolean))];
      const allCuentas = [...new Set([...cuentas, ...cuentasEnGastos])].sort();
      filterCuenta.innerHTML = `<option value="">Todas las cuentas</option>` +
        allCuentas.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

      // Renderizar con filtros actuales
      const filtered = applyFilters(allExpenses, getCurrentFilter());
      renderTable(filtered);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="error">${escapeHtml(e?.message || String(e))}</td></tr>`;
    }
  }

  // ── Cargar cuentas del presupuesto para el select del modal ──
  cuentas = (await loadCuentasFromBudget()) || CUENTAS_DEFAULT;
  selCuenta.innerHTML = cuentas.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  // ── Cargar partidas del presupuesto para el selector ──
  partidas = await loadPartidasFromBudget();
  if (partidas.length) {
    partidas.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.uid || "";
      const label = [p.cuenta, p.concepto].filter(Boolean).join(" / ");
      const total = Number.isFinite(Number(p.total)) ? ` (${fmt(Number(p.total))})` : "";
      opt.textContent = label + total;
      selPartida.appendChild(opt);
    });
  } else {
    selPartida.innerHTML = `<option value="">— Sin partidas en presupuesto —</option>`;
    selPartida.disabled = true;
  }

  // Al seleccionar una partida, sincronizar cuenta
  selPartida.addEventListener("change", () => {
    const uid = selPartida.value;
    if (!uid) return;
    const p = partidas.find(x => x.uid === uid);
    if (p?.cuenta) {
      // Si la cuenta de la partida está en la lista, seleccionarla
      const opt = Array.from(selCuenta.options).find(o => o.value === p.cuenta);
      if (opt) selCuenta.value = p.cuenta;
    }
    if (p?.concepto && !inpConcepto.value.trim()) {
      inpConcepto.value = p.concepto;
    }
  });

  // ── Comprobante: helpers ──
  function showComprobantePreview(file) {
    btnQuitarComp.style.display = "inline-flex";
    uploadWarn.style.display = "none";
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      comprobantePreview.innerHTML = `<img src="${escapeHtml(url)}" alt="preview" style="max-height:100px;max-width:100%;border-radius:6px;border:1px solid rgba(0,0,0,.15);" />`;
    } else {
      comprobantePreview.innerHTML = `<span style="font-size:12px;">📄 ${escapeHtml(file.name)}</span>`;
    }
    comprobantePreview.style.display = "block";
  }

  function clearReceipt() {
    pendingFile = null;
    inpReceiptCamera.value = "";
    inpReceiptUpload.value = "";
    comprobantePreview.style.display = "none";
    comprobantePreview.innerHTML = "";
    btnQuitarComp.style.display = "none";
    uploadWarn.style.display = "none";
  }

  function handleFileSelected(file) {
    if (!file) return;
    if (file.size > COMPROBANTE_MAX_MB * 1024 * 1024) {
      uploadWarn.textContent = `El archivo excede el límite de ${COMPROBANTE_MAX_MB}MB.`;
      uploadWarn.style.display = "block";
      inpReceiptCamera.value = "";
      inpReceiptUpload.value = "";
      return;
    }
    pendingFile = file;
    showComprobantePreview(file);
  }

  // Botones de comprobante
  btnCamera.addEventListener("click", () => inpReceiptCamera.click());
  btnUpload.addEventListener("click", () => inpReceiptUpload.click());
  btnQuitarComp.addEventListener("click", clearReceipt);
  inpReceiptCamera.addEventListener("change", () => handleFileSelected(inpReceiptCamera.files?.[0]));
  inpReceiptUpload.addEventListener("change", () => handleFileSelected(inpReceiptUpload.files?.[0]));

  // ── Filtros ──
  searchEl.addEventListener("input", () => {
    renderTable(applyFilters(allExpenses, getCurrentFilter()));
  });
  filterCuenta.addEventListener("change", () => {
    renderTable(applyFilters(allExpenses, getCurrentFilter()));
  });
  btnClear.addEventListener("click", () => {
    searchEl.value = "";
    filterCuenta.value = "";
    renderTable(allExpenses);
  });

  // ── Modal ──
  function openModal() {
    validMsg.style.display = "none";
    uploadMsg.style.display = "none";
    inpFecha.value = new Date().toISOString().slice(0, 10);
    inpMonto.value = "";
    inpConcepto.value = "";
    inpProveedor.value = "";
    inpResponsable.value = "";
    selPartida.value = "";
    clearReceipt();
    backdrop.style.display = "flex";
    inpMonto.focus();
  }
  function closeModal() { backdrop.style.display = "none"; }

  btnNuevo.addEventListener("click", openModal);
  btnClose.addEventListener("click", closeModal);
  btnCancel.addEventListener("click", closeModal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });

  btnSave.addEventListener("click", async () => {
    validMsg.style.display = "none";
    uploadMsg.style.display = "none";

    const fecha = inpFecha.value;
    const cuenta = selCuenta.value;
    const monto = parseFloat(inpMonto.value);

    if (!fecha) {
      validMsg.textContent = "La fecha es obligatoria.";
      validMsg.style.display = "block";
      return;
    }
    if (!cuenta) {
      validMsg.textContent = "Selecciona una cuenta.";
      validMsg.style.display = "block";
      return;
    }
    if (!monto || monto <= 0) {
      validMsg.textContent = "El monto debe ser mayor a 0.";
      validMsg.style.display = "block";
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = "Guardando…";

    try {
      // ── Subir comprobante si hay archivo ──
      let comprobante_path = null;
      let comprobante_name = null;
      uploadWarn.style.display = "none";

      if (pendingFile) {
        uploadMsg.textContent = "Subiendo comprobante…";
        uploadMsg.style.display = "block";
        try {
          let fileToUpload = pendingFile;

          // Comprimir PDF si aplica (no bloquea si falla)
          if (pendingFile.type === "application/pdf") {
            try {
              const { file: compressed } = await maybeCompressPdfFile(pendingFile);
              fileToUpload = compressed;
            } catch { /* usar original */ }
          }

          const userId = window.appState.user.id;
          const projectId = window.appState.project.id;
          const path = buildStoragePath({
            userId,
            projectId,
            area: "gastos",
            docKey: "comprobantes",
            filename: fileToUpload.name,
          });

          await uploadFile({
            file: fileToUpload,
            path,
            bucket: STORAGE_BUCKET,
            upsert: false,
            contentType: fileToUpload.type || undefined,
          });

          comprobante_path = path;
          comprobante_name = pendingFile.name;
          uploadMsg.style.display = "none";
        } catch {
          // Upload falló → guardar gasto sin comprobante y avisar
          uploadMsg.style.display = "none";
          uploadWarn.textContent = "⚠ No se pudo subir el comprobante. El gasto se guardará sin él.";
          uploadWarn.style.display = "block";
        }
      }

      await createExpense({
        fecha,
        cuenta,
        concepto: inpConcepto.value.trim(),
        monto,
        proveedor: inpProveedor.value.trim(),
        responsable: inpResponsable.value.trim(),
        budget_item_uid: selPartida.value || null,
        comprobante_path,
        comprobante_name,
      });

      closeModal();
      showMsg("Gasto registrado correctamente.");
      await loadAndRender();
    } catch (e) {
      validMsg.textContent = e?.message || String(e);
      validMsg.style.display = "block";
      uploadMsg.style.display = "none";
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Guardar gasto";
    }
  });

  // ── Init ──
  await loadAndRender();
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
