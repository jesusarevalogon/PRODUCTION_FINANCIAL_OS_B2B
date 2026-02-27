/* =========================================================
  src/modules/presupuesto.js
  PRESUPUESTO PRODUCTORA — v2_productora

  Módulo Presupuesto Operación Real (Productora):
  ✅ Métodos de pago: transferencia | efectivo | especie_productora
  ✅ Factura por partida (booleano operativo)
  ✅ IVA por partida: 16 | 8 | 0 | exento
  ✅ Cálculo: subtotal = monto_unitario × cantidad × plazo_cantidad
  ✅ Resumen: EFECTIVO (transferencia+efectivo) vs ESPECIE (productora)
  ✅ Migración lazy desde datos v1 (FOCINE/CENTRO/formaPago/plazo)
  ✅ CSV import: normaliza valores legacy y acepta nuevos
  ✅ Selección múltiple (Ctrl/Cmd + click, Shift + rango)
  ✅ Paginado (20) + Ver todos, buscador, filtro etapa
  ✅ Persistencia: project_state (module_key = "presupuesto")
========================================================= */

import { exportarPresupuestoPDF } from "../services/presupuestoPdfExport.js";
import { loadModuleState, saveModuleState } from "../services/stateService.js";

/* =========================================================
  Exponer función global para que Documentación pueda abrir
  la vista previa de Presupuesto.
========================================================= */
if (typeof window !== "undefined") {
  // Llamada desde Documentación u otros módulos: por default muestra Ambos (resumen + desglose)
  window.openPresupuestoPreview = function (choice = "3") {
    exportarPresupuestoPDF({ choice }).catch((e) => alert(e?.message || String(e)));
  };
}

// ─── Constantes ───────────────────────────────────────────
const ETAPAS = ["PREPRODUCCIÓN", "PRODUCCIÓN", "POSTPRODUCCIÓN"];

const PAYMENT_METHODS = ["transferencia", "efectivo", "especie_productora"];

const IVA_TIPOS = [16, 8, 0, "exento"];

const CUENTAS = [
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

// ─── Labels de display ────────────────────────────────────
function labelPaymentMethod(pm) {
  if (pm === "transferencia") return "Transferencia";
  if (pm === "efectivo") return "Efectivo";
  if (pm === "especie_productora") return "Especie";
  return pm || "";
}

function labelIvaTipo(t) {
  if (t === "exento") return "Exento";
  if (t === 0 || t === "0") return "0%";
  if (t === 8 || t === "8") return "8%";
  if (t === 16 || t === "16") return "16%";
  return String(t ?? "");
}

// ─── renderPresupuestoView ────────────────────────────────
export function renderPresupuestoView() {
  const cuentasOptions = CUENTAS.map(
    (c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`
  ).join("");

  const etapasOptions = ETAPAS.map(
    (e) => `<option value="${escapeAttr(e)}">${escapeHtml(e)}</option>`
  ).join("");

  const filtroEtapasOptions = [
    `<option value="">Todas las etapas</option>`,
    ...ETAPAS.map((e) => `<option value="${escapeAttr(e)}">${escapeHtml(e)}</option>`),
  ].join("");

  const paymentMethodOptions = PAYMENT_METHODS.map(
    (pm) => `<option value="${pm}">${escapeHtml(labelPaymentMethod(pm))}</option>`
  ).join("");

  // "exento" es valor interno (especie); no se expone en la UI
  const ivaTipoOptions = [16, 8, 0].map(
    (t) => `<option value="${t}">${escapeHtml(labelIvaTipo(t))}</option>`
  ).join("");

  return `
    <div class="grid">
      <div class="card">
        <h2>Presupuesto / Esquema</h2>
        <p class="muted">Se actualiza automáticamente al crear/editar/eliminar.</p>

        <div class="table-wrap">
          <table class="table" id="budgetSummaryTable">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody id="budgetSummaryTbody"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Acciones</h2>
        <div class="rc-actions">
          <button id="bgBtnCrear" class="btn btn-primary">Crear</button>
          <button id="bgBtnEditar" class="btn btn-light" disabled>Editar</button>
          <button id="bgBtnEliminar" class="btn btn-danger" disabled>Eliminar</button>
        </div>

        <div class="rc-actions" style="margin-top:10px;">
          <button id="bgBtnCargaMasiva" class="btn btn-secondary">Carga masiva</button>
          <button id="bgBtnExportarPDF" class="btn btn-secondary">VISTA PREVIA</button>
          <button id="bgBtnDescargar" class="btn btn-light">Descargar CSV</button>
        </div>

        <hr class="hr" />
        <p class="muted">
          Modo actual: <b>V2_PRODUCTORA</b>
        </p>
      </div>
    </div>

    <div class="card mt">
      <h2>Desglose</h2>
      <p class="muted">Tip: Ctrl/Cmd + click para seleccionar varios. Shift + click para rango.</p>

      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:10px 0 12px;">
        <div style="flex:1; min-width:220px;">
          <input id="bgSearchInput" type="text" placeholder="Buscar (concepto, cuenta, entidad, etapa)…"
                 style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12); outline:none;" />
        </div>

        <div style="min-width:220px;">
          <select id="bgFilterEtapa" style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12);">
            ${filtroEtapasOptions}
          </select>
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
          <button id="bgTabPaged" class="btn btn-light">Paginado (20)</button>
          <button id="bgTabAll" class="btn btn-light">Ver todos</button>
        </div>
      </div>

      <div id="bgPagerBar" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:-2px 0 10px;">
        <button id="bgPagePrev" class="btn btn-light">←</button>
        <div class="muted" id="bgPageInfo">Página 1 / 1</div>
        <button id="bgPageNext" class="btn btn-light">→</button>
        <div style="flex:1"></div>
        <div class="muted" id="bgResultsInfo">0 resultados</div>
      </div>

      <div class="table-wrap">
        <table class="table" id="budgetTable">
          <thead>
            <tr>
              <th>Etapa</th>
              <th>Concepto</th>
              <th>Cuenta</th>
              <th>Entidad</th>
              <th>Método de pago</th>
              <th>Factura</th>
              <th>Monto</th>
              <th>Cantidad</th>
              <th>Plazo</th>
              <th>Subtotal</th>
              <th>IVA</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody id="budgetTbody"></tbody>
        </table>
      </div>
    </div>

    <!-- Modal Crear/Editar -->
    <div id="bgModalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h3 id="bgModalTitle">Crear partida</h3>
          <button id="bgModalClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="modal-body">
          <div class="form-grid">
            <label>
              <span>Etapa</span>
              <select id="bgEtapa">${etapasOptions}</select>
            </label>

            <label>
              <span>Concepto</span>
              <input id="bgConcepto" type="text" placeholder="Ej. Renta Cámara" />
            </label>

            <label>
              <span>Cuenta</span>
              <select id="bgCuenta">${cuentasOptions}</select>
            </label>

            <label>
              <span>Entidad (proveedor / área)</span>
              <input id="bgEntidad" type="text" placeholder="Ej. Proveedor XYZ" />
            </label>

            <label>
              <span>Método de pago</span>
              <select id="bgPaymentMethod">${paymentMethodOptions}</select>
            </label>

            <label style="display:flex; align-items:center; gap:12px; cursor:pointer;">
              <span>Facturado</span>
              <input id="bgFacturado" type="checkbox" style="width:18px; height:18px; cursor:pointer;" />
            </label>

            <label>
              <span>IVA</span>
              <select id="bgIvaTipo">${ivaTipoOptions}</select>
            </label>

            <label>
              <span>Monto unitario</span>
              <input id="bgMonto" type="number" min="0.01" step="0.01" placeholder="0.00" />
            </label>

            <label>
              <span>Cantidad</span>
              <input id="bgCantidad" type="number" min="1" step="1" placeholder="1" />
            </label>

            <label>
              <span>Tipo de plazo</span>
              <select id="bgPlazoTipo">
                <option value="proyecto">Por proyecto</option>
                <option value="dias">Por días</option>
              </select>
            </label>

            <label id="bgPlazoDiasWrap" style="display:none;">
              <span>Días</span>
              <input id="bgPlazoDias" type="number" min="1" step="1" placeholder="Ej. 5" />
            </label>
          </div>

          <p class="muted" id="bgValidationMsg" style="display:none; margin-top:10px;"></p>
        </div>

        <div class="modal-footer">
          <button id="bgModalCancel" class="btn btn-light">Cancelar</button>
          <button id="bgModalSave" class="btn btn-primary">Guardar</button>
        </div>
      </div>
    </div>

    <!-- Modal Vista Previa PDF -->
    <div id="bgPdfModalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <h3>Vista previa del Presupuesto</h3>
          <button id="bgPdfModalClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body">
          <p class="muted" style="margin:0 0 14px;">Selecciona qué sección deseas abrir:</p>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
              <input type="radio" name="bgPdfChoice" value="3" checked />
              <span>Ambos — Resumen + Desglose</span>
            </label>
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
              <input type="radio" name="bgPdfChoice" value="1" />
              <span>Solo Resumen (1 hoja portrait)</span>
            </label>
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
              <input type="radio" name="bgPdfChoice" value="2" />
              <span>Solo Desglose (landscape)</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button id="bgPdfModalCancel" class="btn btn-light">Cancelar</button>
          <button id="bgPdfModalConfirm" class="btn btn-primary">Abrir vista previa</button>
        </div>
      </div>
    </div>

    <!-- Modal Carga Masiva -->
    <div id="bgBulkBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width: 1080px; display:flex; flex-direction:column; max-height: 88vh;">
        <div class="modal-header">
          <h3>Carga masiva (CSV / XLSX)</h3>
          <button id="bgBulkClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="modal-body" style="flex:1 1 auto; overflow:auto;">
          <p class="muted" style="margin:0 0 10px;">
            Columnas requeridas:
            <br/>
            <b>ETAPA | CONCEPTO | CUENTA | ENTIDAD | PAYMENT_METHOD | FACTURADO | MONTO | CANTIDAD | IVA_TIPO</b>
            <br/>
            <small>
              PAYMENT_METHOD: <code>transferencia</code> / <code>efectivo</code> / <code>especie_productora</code>
              &nbsp;·&nbsp;
              IVA_TIPO: <code>16</code> / <code>8</code> / <code>0</code> / <code>exento</code>
              &nbsp;·&nbsp;
              FACTURADO: <code>si</code> / <code>no</code> / <code>true</code> / <code>false</code>
            </small>
          </p>

          <div class="rc-actions" style="margin:10px 0 10px; gap:10px; flex-wrap:wrap;">
            <input id="bgBulkFile" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <button id="bgBulkLoadFile" class="btn btn-light" type="button">Cargar archivo (CSV/XLSX)</button>
            <button id="bgBulkTemplate" class="btn btn-light" type="button">Descargar plantilla CSV</button>
            <div class="muted" style="flex:1; min-width:220px;">
              Tip: descarga la plantilla para obtener el formato correcto.
            </div>
          </div>

          <textarea id="bgBulkText" style="width:100%; height:140px; resize:vertical;"
placeholder="ETAPA	CONCEPTO	CUENTA	ENTIDAD	PAYMENT_METHOD	FACTURADO	MONTO	CANTIDAD	IVA_TIPO
PREPRODUCCIÓN	Renta cámara	EQUIPO DE CÁMARA	Proveedor XYZ	transferencia	false	5000	1	16"></textarea>

          <div class="rc-actions" style="position:sticky; bottom:0; padding:10px 0; margin-top:10px; background:#0f0f10;">
            <button id="bgBulkPreview" class="btn btn-secondary">Previsualizar</button>
            <div style="flex:1"></div>
            <button id="bgBulkCommit" class="btn btn-primary" disabled>Agregar 0 partidas</button>
          </div>

          <div id="bgBulkErrors" class="muted" style="display:none; margin-top:10px;"></div>

          <div class="table-wrap" style="margin-top:10px;">
            <table class="table" id="bgBulkTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Etapa</th>
                  <th>Concepto</th>
                  <th>Cuenta</th>
                  <th>Entidad</th>
                  <th>Método</th>
                  <th>Factura</th>
                  <th>Monto</th>
                  <th>Cant.</th>
                  <th>IVA</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody id="bgBulkTbody"></tbody>
            </table>
          </div>
        </div>

        <div class="modal-footer">
          <button id="bgBulkCancel" class="btn btn-light">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

// ─── bindPresupuestoEvents ────────────────────────────────
export async function bindPresupuestoEvents() {
  // ── DOM refs ──
  const summaryTbody = document.getElementById("budgetSummaryTbody");
  const tbody = document.getElementById("budgetTbody");

  const btnCrear = document.getElementById("bgBtnCrear");
  const btnEditar = document.getElementById("bgBtnEditar");
  const btnEliminar = document.getElementById("bgBtnEliminar");
  const btnDescargar = document.getElementById("bgBtnDescargar");
  const btnExportarPDF = document.getElementById("bgBtnExportarPDF");
  const btnCargaMasiva = document.getElementById("bgBtnCargaMasiva");

  const inpSearch = document.getElementById("bgSearchInput");
  const selFilterEtapa = document.getElementById("bgFilterEtapa");
  const btnTabPaged = document.getElementById("bgTabPaged");
  const btnTabAll = document.getElementById("bgTabAll");
  const pagerBar = document.getElementById("bgPagerBar");
  const btnPagePrev = document.getElementById("bgPagePrev");
  const btnPageNext = document.getElementById("bgPageNext");
  const pageInfo = document.getElementById("bgPageInfo");
  const resultsInfo = document.getElementById("bgResultsInfo");

  // Modal crear/editar
  const modalBackdrop = document.getElementById("bgModalBackdrop");
  const modalTitle = document.getElementById("bgModalTitle");
  const modalClose = document.getElementById("bgModalClose");
  const modalCancel = document.getElementById("bgModalCancel");
  const modalSave = document.getElementById("bgModalSave");
  const validationMsg = document.getElementById("bgValidationMsg");

  const selEtapa = document.getElementById("bgEtapa");
  const inpConcepto = document.getElementById("bgConcepto");
  const selCuenta = document.getElementById("bgCuenta");
  const inpEntidad = document.getElementById("bgEntidad");
  const selPaymentMethod = document.getElementById("bgPaymentMethod");
  const chkFacturado = document.getElementById("bgFacturado");
  const selIvaTipo = document.getElementById("bgIvaTipo");
  const inpMonto = document.getElementById("bgMonto");
  const inpCantidad = document.getElementById("bgCantidad");
  const selPlazoTipo = document.getElementById("bgPlazoTipo");
  const inpPlazoDias = document.getElementById("bgPlazoDias");
  const plazoDiasWrap = document.getElementById("bgPlazoDiasWrap");

  // Modal PDF
  const pdfModalBackdrop = document.getElementById("bgPdfModalBackdrop");
  const pdfModalClose = document.getElementById("bgPdfModalClose");
  const pdfModalCancel = document.getElementById("bgPdfModalCancel");
  const pdfModalConfirm = document.getElementById("bgPdfModalConfirm");

  // Modal carga masiva
  const bulkBackdrop = document.getElementById("bgBulkBackdrop");
  const bulkClose = document.getElementById("bgBulkClose");
  const bulkCancel = document.getElementById("bgBulkCancel");
  const bulkText = document.getElementById("bgBulkText");
  const bulkFile = document.getElementById("bgBulkFile");
  const bulkLoadFile = document.getElementById("bgBulkLoadFile");
  const bulkTemplate = document.getElementById("bgBulkTemplate");
  const bulkPreview = document.getElementById("bgBulkPreview");
  const bulkCommit = document.getElementById("bgBulkCommit");
  const bulkErrors = document.getElementById("bgBulkErrors");
  const bulkTbody = document.getElementById("bgBulkTbody");

  const userId = window?.appState?.user?.id;
  const projectId = window?.appState?.project?.id;
  if (!userId || !projectId) {
    throw new Error("Sesión o proyecto no inicializado. Selecciona un proyecto en la sección Proyectos.");
  }

  const MOD_KEY = "presupuesto";

  // ── Estado ──
  let seq = 0;
  let items = [];

  // ── Cargar + migrar ──
  try {
    const rawState = await loadModuleState({ userId, projectId, moduleKey: MOD_KEY });
    const migrated = migrateStateIfNeeded(rawState);
    items = Array.isArray(migrated?.items) ? migrated.items : [];
    seq = Number.isFinite(Number(migrated?.seq)) ? Number(migrated.seq) : 0;

    // Si hubo migración, persistir de inmediato
    if (migrated !== rawState) {
      await saveModuleState({
        userId,
        projectId,
        moduleKey: MOD_KEY,
        data: buildSaveData(),
      }).catch((e) => console.warn("[presupuesto] auto-save post-migración falló:", e));
    }
  } catch (e) {
    throw new Error(`No pude cargar Presupuesto desde servidor: ${e?.message || String(e)}`);
  }

  // ── saveInFlight ANTES del primer renderAll ──
  let saveInFlight = Promise.resolve();

  function buildSaveData() {
    return {
      version: "v2_productora",
      seq,
      items,
      meta: { updatedAt: new Date().toISOString(), notes: "" },
    };
  }

  function saveItemsAsync() {
    saveInFlight = saveInFlight
      .catch(() => {})
      .then(() =>
        saveModuleState({
          userId,
          projectId,
          moduleKey: MOD_KEY,
          data: buildSaveData(),
        })
      );
    return saveInFlight;
  }

  function getNextSeqLocal() {
    seq = (Number.isFinite(seq) ? seq : 0) + 1;
    return seq;
  }

  function mkUid() {
    return crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now();
  }

  // ── Selección múltiple ──
  let selectedUids = new Set();
  let lastClickedUid = null;

  let modalMode = "create";
  let bulkParsed = [];

  // ── Estado UI (filtro / búsqueda / paginado) ──
  const PAGE_SIZE = 20;
  let uiSearch = "";
  let uiFilterEtapa = "";
  let uiViewAll = false;
  let uiPage = 0;

  if (btnTabPaged && btnTabAll) setTabButtons();
  if (pagerBar) pagerBar.style.display = uiViewAll ? "none" : "flex";

  renderAll();

  // ── Listeners ──
  btnCrear.addEventListener("click", () => openModal("create"));
  btnEditar.addEventListener("click", () => openModal("edit"));
  btnEliminar.addEventListener("click", deleteSelected);
  btnDescargar.addEventListener("click", downloadCSV);

  btnExportarPDF.addEventListener("click", () => {
    // Resetear radio a "Ambos" y abrir modal de elección
    const radioDefault = pdfModalBackdrop.querySelector("input[name=bgPdfChoice][value='3']");
    if (radioDefault) radioDefault.checked = true;
    pdfModalBackdrop.style.display = "flex";
  });
  pdfModalClose.addEventListener("click", () => { pdfModalBackdrop.style.display = "none"; });
  pdfModalCancel.addEventListener("click", () => { pdfModalBackdrop.style.display = "none"; });
  pdfModalBackdrop.addEventListener("click", (e) => {
    if (e.target === pdfModalBackdrop) pdfModalBackdrop.style.display = "none";
  });
  pdfModalConfirm.addEventListener("click", async () => {
    const choice = pdfModalBackdrop.querySelector("input[name=bgPdfChoice]:checked")?.value || "3";
    pdfModalBackdrop.style.display = "none";
    try {
      await exportarPresupuestoPDF({ choice });
    } catch (e) {
      alert(e?.message || String(e));
    }
  });

  btnCargaMasiva.addEventListener("click", openBulkModal);
  bulkClose.addEventListener("click", closeBulkModal);
  bulkCancel.addEventListener("click", closeBulkModal);
  bulkBackdrop.addEventListener("click", (e) => {
    if (e.target === bulkBackdrop) closeBulkModal();
  });
  bulkPreview.addEventListener("click", previewBulk);
  bulkCommit.addEventListener("click", commitBulk);
  bulkLoadFile?.addEventListener("click", () => { void loadBulkFromFile(); });
  bulkTemplate?.addEventListener("click", downloadBulkTemplateCSV);

  modalClose.addEventListener("click", closeModal);
  modalCancel.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  modalSave.addEventListener("click", saveModal);

  selPaymentMethod.addEventListener("change", applyPaymentMethodRulesToModal);
  chkFacturado.addEventListener("change", applyFacturadoRule);
  selPlazoTipo.addEventListener("change", applyPlazoRules);

  inpMonto.addEventListener("blur", () => clampInput(inpMonto, 0.01, false));
  inpCantidad.addEventListener("blur", () => clampInput(inpCantidad, 1, true));
  inpPlazoDias.addEventListener("blur", () => clampInput(inpPlazoDias, 1, true));

  inpSearch?.addEventListener("input", () => {
    uiSearch = (inpSearch.value || "").trim();
    uiPage = 0;
    renderTable();
  });

  selFilterEtapa?.addEventListener("change", () => {
    uiFilterEtapa = (selFilterEtapa.value || "").trim();
    uiPage = 0;
    renderTable();
  });

  btnTabPaged?.addEventListener("click", () => {
    uiViewAll = false;
    uiPage = 0;
    setTabButtons();
    if (pagerBar) pagerBar.style.display = "flex";
    renderTable();
  });

  btnTabAll?.addEventListener("click", () => {
    uiViewAll = true;
    uiPage = 0;
    setTabButtons();
    if (pagerBar) pagerBar.style.display = "none";
    renderTable();
  });

  btnPagePrev?.addEventListener("click", () => {
    uiPage = Math.max(0, uiPage - 1);
    renderTable();
  });

  btnPageNext?.addEventListener("click", () => {
    const { totalPages } = getFilteredAndPagedItems();
    uiPage = Math.min(Math.max(0, totalPages - 1), uiPage + 1);
    renderTable();
  });

  // ── Pestañas UI ──
  function setTabButtons() {
    if (!btnTabPaged || !btnTabAll) return;
    const on = (btn) => {
      btn.style.border = "1px solid rgba(0,0,0,.12)";
      btn.style.fontWeight = "900";
      btn.style.opacity = "1";
    };
    const off = (btn) => {
      btn.style.border = "1px solid rgba(0,0,0,.10)";
      btn.style.fontWeight = "700";
      btn.style.opacity = ".75";
    };
    if (uiViewAll) { off(btnTabPaged); on(btnTabAll); }
    else { on(btnTabPaged); off(btnTabAll); }
  }

  // ── Normalización / migración ──

  function normalizeEtapa(v) {
    const s = norm(v);
    if (s === "PREPRODUCCION" || s === "PRE PRODUCCION") return "PREPRODUCCIÓN";
    if (s === "PRODUCCION") return "PRODUCCIÓN";
    if (s === "POSTPRODUCCION" || s === "POST PRODUCCION" || s === "POST-PRODUCCION") return "POSTPRODUCCIÓN";
    return null;
  }

  function normalizePaymentMethod(v) {
    const s = norm(v || "");
    if (s === "TRANSFERENCIA") return "transferencia";
    if (s === "EFECTIVO") return "efectivo";
    if (s === "ESPECIE_PRODUCTORA" || s === "ESPECIE PRODUCTORA") return "especie_productora";
    // Compat: valores legacy CSV / formaPago viejo
    if (s === "ESPECIE") return "especie_productora";
    if (["TARJETA", "DEPOSITO", "PAYPAL", "SPEI", "BANCO"].includes(s)) return "transferencia";
    return null;
  }

  function normalizeIvaTipo(v) {
    const s = norm(String(v ?? ""));
    if (s === "16") return 16;
    if (s === "8") return 8;
    if (s === "0") return 0;
    if (s === "EXENTO") return "exento";
    return null;
  }

  function normalizeFacturado(v) {
    const s = norm(String(v ?? ""));
    if (s === "SI" || s === "TRUE" || s === "1" || s === "YES") return true;
    if (s === "NO" || s === "FALSE" || s === "0") return false;
    return null;
  }

  function normalizeCuenta(v) {
    const target = norm((v ?? "").toString().trim());
    const found = CUENTAS.find((c) => norm(c) === target);
    return found || null;
  }

  // Mapeo backward-compat: formaPago + entidad (viejo) → payment_method (nuevo)
  function migratePaymentMethod(formaPago, entidad) {
    const f = norm(formaPago || "");
    const e = norm(entidad || "");
    // ESPECIE viejo o CENTRO (siempre especie) → especie_productora
    if (f === "ESPECIE" || e === "CENTRO") return "especie_productora";
    // EFECTIVO viejo → efectivo
    if (f === "EFECTIVO") return "efectivo";
    // Otros aliases de transferencia
    if (["TARJETA", "DEPOSITO", "PAYPAL", "SPEI", "BANCO"].includes(f)) return "transferencia";
    // Default
    return "transferencia";
  }

  // Migrar un item individual del schema v1 al v2_productora
  function migrateOldItem(old) {
    const pm = migratePaymentMethod(old.formaPago, old.entidad);
    const isEspecie = pm === "especie_productora";

    const iva_tipo = isEspecie ? "exento" : 16;
    const facturado = false;

    // Absorber plazo en monto_unitario para preservar valor financiero
    const oldMonto = toPositiveNumber(old.monto ?? old.monto_unitario, 0.01);
    const oldPlazo = parseInt(old.plazo, 10) || 1;
    const monto_unitario = round2(oldMonto * oldPlazo);
    const cantidad = parseInt(old.cantidad, 10) || 1;

    const subtotal = round2(monto_unitario * cantidad);
    const iva_monto = iva_tipo === "exento" ? 0 : round2(subtotal * (iva_tipo / 100));
    const total = round2(subtotal + iva_monto);

    return {
      uid: old.uid || mkUid(),
      etapa: old.etapa,
      concepto: (old.concepto || "").trim(),
      cuenta: old.cuenta,
      entidad: (old.entidad || "").trim(),
      payment_method: pm,
      facturado,
      monto_unitario,
      cantidad,
      iva_tipo,
      subtotal,
      iva_monto,
      total,
      createdAt: old.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
  }

  // Detectar si un item ya tiene schema v2
  function isV2Item(it) {
    return it.payment_method !== undefined && it.monto_unitario !== undefined;
  }

  // Migración lazy del estado completo
  function migrateStateIfNeeded(rawState) {
    if (!rawState) return rawState;
    // Si ya es v2_productora, no migrar
    if (rawState.version === "v2_productora") return rawState;

    const rawItems = Array.isArray(rawState.items) ? rawState.items : [];
    const migratedItems = rawItems.map((it) => {
      if (isV2Item(it)) return normalizeItem(it); // ya migrado, solo normalizar
      return migrateOldItem(it);
    });

    return {
      version: "v2_productora",
      seq: rawState.seq || 0,
      items: migratedItems,
      meta: { updatedAt: new Date().toISOString(), notes: "" },
    };
  }

  // Motor de cálculo único (función pura)
  function normalizeItem(it) {
    const pm = normalizePaymentMethod(it.payment_method) || "transferencia";
    const isEspecie = pm === "especie_productora";

    // Facturado: especie siempre false
    const facturado = isEspecie ? false : Boolean(it.facturado ?? false);

    // IVA: especie → exento | sin factura → 0 | con factura → valor guardado
    let iva_tipo;
    if (isEspecie) {
      iva_tipo = "exento";
    } else if (!facturado) {
      iva_tipo = 0;
    } else {
      iva_tipo = it.iva_tipo ?? 16;
      if (!IVA_TIPOS.includes(iva_tipo)) iva_tipo = 16;
    }

    let cantidad = parseInt(it.cantidad ?? 1, 10);
    if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;

    const plazo_tipo = it.plazo_tipo === "dias" ? "dias" : "proyecto";
    // backward compat: old field was plazo_dias
    let plazo_cantidad = plazo_tipo === "dias"
      ? parseInt(it.plazo_cantidad ?? it.plazo_dias ?? 1, 10)
      : 1;
    if (!Number.isFinite(plazo_cantidad) || plazo_cantidad < 1) plazo_cantidad = 1;

    const monto_unitario = toPositiveNumber(it.monto_unitario, 0.01);
    // plazo_tipo="dias" multiplica por plazo_cantidad; "proyecto" × 1 (sin cambio)
    const subtotal = round2(monto_unitario * cantidad * plazo_cantidad);
    const iva_monto = (iva_tipo === "exento" || iva_tipo === 0) ? 0 : round2(subtotal * (iva_tipo / 100));
    const total = round2(subtotal + iva_monto);

    return {
      uid: it.uid || mkUid(),
      etapa: it.etapa,
      concepto: (it.concepto || "").trim(),
      cuenta: it.cuenta,
      entidad: (it.entidad || "").trim(),
      payment_method: pm,
      facturado,
      monto_unitario,
      cantidad,
      iva_tipo,
      subtotal,
      iva_monto,
      total,
      plazo_tipo,
      plazo_cantidad,
      createdAt: it.createdAt ?? Date.now(),
      updatedAt: it.updatedAt ?? Date.now(),
    };
  }

  // ── Render ──

  function renderAll() {
    items = items.map((x) => {
      const etapa = normalizeEtapa(x.etapa) || ETAPAS[0];
      const cuenta = normalizeCuenta(x.cuenta) || CUENTAS[0];
      return normalizeItem({ ...x, etapa, cuenta });
    });

    const valid = new Set(items.map((x) => x.uid));
    selectedUids = new Set([...selectedUids].filter((u) => valid.has(u)));
    if (lastClickedUid && !valid.has(lastClickedUid)) lastClickedUid = null;

    saveItemsAsync().catch((e) => console.error("[presupuesto] saveModuleState failed:", e));

    renderSummary();
    renderTable();
    syncButtons();
  }

  function syncButtons() {
    const n = selectedUids.size;
    btnEditar.disabled = n !== 1;
    btnEliminar.disabled = n === 0;
  }

  function renderSummary() {
    // Acumuladores por etapa × tipo
    const byEtapaEfectivo = {};
    const byEtapaEspecie = {};
    ETAPAS.forEach((e) => { byEtapaEfectivo[e] = 0; byEtapaEspecie[e] = 0; });

    let totalEfectivo = 0;
    let totalEspecie = 0;

    items.forEach((it) => {
      const etapa = it.etapa || ETAPAS[0];
      if (it.payment_method === "especie_productora") {
        byEtapaEspecie[etapa] = (byEtapaEspecie[etapa] || 0) + it.total;
        totalEspecie += it.total;
      } else {
        byEtapaEfectivo[etapa] = (byEtapaEfectivo[etapa] || 0) + it.total;
        totalEfectivo += it.total;
      }
    });

    totalEfectivo = round2(totalEfectivo);
    totalEspecie = round2(totalEspecie);
    const totalProyecto = round2(totalEfectivo + totalEspecie);

    summaryTbody.innerHTML = "";

    // Sección EFECTIVO
    const trEfHdr = document.createElement("tr");
    trEfHdr.innerHTML = `<td colspan="2" style="font-weight:900; background:rgba(255,255,255,.06); padding:8px 10px; letter-spacing:.3px;">EFECTIVO (transferencia + efectivo)</td>`;
    summaryTbody.appendChild(trEfHdr);

    ETAPAS.forEach((etapa) => {
      const v = round2(byEtapaEfectivo[etapa] || 0);
      if (!v) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="padding-left:22px;">${escapeHtml(etapa)}</td><td>${money(v)}</td>`;
      summaryTbody.appendChild(tr);
    });

    const trEfTotal = document.createElement("tr");
    trEfTotal.innerHTML = `<td><b>Total Efectivo</b></td><td><b>${money(totalEfectivo)}</b></td>`;
    summaryTbody.appendChild(trEfTotal);

    // Sección ESPECIE
    const trEsHdr = document.createElement("tr");
    trEsHdr.innerHTML = `<td colspan="2" style="font-weight:900; background:rgba(255,255,255,.06); padding:8px 10px; letter-spacing:.3px;">ESPECIE (productora)</td>`;
    summaryTbody.appendChild(trEsHdr);

    ETAPAS.forEach((etapa) => {
      const v = round2(byEtapaEspecie[etapa] || 0);
      if (!v) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="padding-left:22px;">${escapeHtml(etapa)}</td><td>${money(v)}</td>`;
      summaryTbody.appendChild(tr);
    });

    const trEsTotal = document.createElement("tr");
    trEsTotal.innerHTML = `<td><b>Total Especie</b></td><td><b>${money(totalEspecie)}</b></td>`;
    summaryTbody.appendChild(trEsTotal);

    // TOTAL PROYECTO
    const trGrand = document.createElement("tr");
    trGrand.innerHTML = `
      <td style="border-top:2px solid rgba(255,255,255,.2);"><b>TOTAL PROYECTO</b></td>
      <td style="border-top:2px solid rgba(255,255,255,.2);"><b style="font-size:1.1em;">${money(totalProyecto)}</b></td>
    `;
    summaryTbody.appendChild(trGrand);
  }

  function getFilteredAndPagedItems() {
    const q = norm(uiSearch);
    const etapaFilter = (uiFilterEtapa || "").trim();

    const filtered = items.filter((it) => {
      if (etapaFilter && it.etapa !== etapaFilter) return false;
      if (!q) return true;
      const hay = [it.concepto, it.cuenta, it.entidad, it.etapa, it.payment_method]
        .filter(Boolean)
        .map(norm)
        .join(" | ");
      return hay.includes(q);
    });

    const total = filtered.length;

    if (uiViewAll) {
      return { filtered, pageItems: filtered, total, totalPages: 1, page: 0 };
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(uiPage, totalPages - 1));
    uiPage = safePage;

    const start = safePage * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);
    return { filtered, pageItems, total, totalPages, page: safePage };
  }

  function renderTable() {
    const { pageItems, total, totalPages, page } = getFilteredAndPagedItems();

    tbody.innerHTML = "";
    pageItems.forEach((it) => {
      const tr = document.createElement("tr");
      tr.dataset.uid = it.uid;
      if (selectedUids.has(it.uid)) tr.classList.add("is-selected");

      tr.innerHTML = `
        <td>${escapeHtml(it.etapa)}</td>
        <td>${escapeHtml(it.concepto)}</td>
        <td>${escapeHtml(it.cuenta)}</td>
        <td>${escapeHtml(it.entidad)}</td>
        <td>${escapeHtml(labelPaymentMethod(it.payment_method))}</td>
        <td>${it.facturado ? "Sí" : "—"}</td>
        <td>${money(it.monto_unitario)}</td>
        <td>${escapeHtml(String(it.cantidad))}</td>
        <td>${it.plazo_tipo === "dias" ? `${it.plazo_cantidad}d` : "—"}</td>
        <td>${money(it.subtotal)}</td>
        <td>${money(it.iva_monto)}</td>
        <td><b>${money(it.total)}</b></td>
      `;

      tr.addEventListener("click", (ev) => onRowClick(ev, it.uid, pageItems));
      tbody.appendChild(tr);
    });

    if (resultsInfo) resultsInfo.textContent = `${total} resultado${total === 1 ? "" : "s"}`;

    if (uiViewAll) {
      if (pageInfo) pageInfo.textContent = `Mostrando todos (${total})`;
      if (btnPagePrev) btnPagePrev.disabled = true;
      if (btnPageNext) btnPageNext.disabled = true;
    } else {
      if (pageInfo) pageInfo.textContent = `Página ${page + 1} / ${totalPages}`;
      if (btnPagePrev) btnPagePrev.disabled = page <= 0;
      if (btnPageNext) btnPageNext.disabled = page >= totalPages - 1;
    }

    syncButtons();
  }

  function onRowClick(ev, uid, visibleItems) {
    const isToggle = ev.ctrlKey || ev.metaKey;
    const isRange = ev.shiftKey;

    if (isRange && lastClickedUid) {
      selectRange(lastClickedUid, uid, visibleItems);
      return;
    }

    if (isToggle) {
      if (selectedUids.has(uid)) selectedUids.delete(uid);
      else selectedUids.add(uid);
      lastClickedUid = uid;
      paintSelection();
      syncButtons();
      return;
    }

    selectedUids = new Set([uid]);
    lastClickedUid = uid;
    paintSelection();
    syncButtons();
  }

  function selectRange(fromUid, toUid, visibleItems) {
    const rowUids = (visibleItems || []).map((x) => x.uid);
    const a = rowUids.indexOf(fromUid);
    const b = rowUids.indexOf(toUid);

    if (a === -1 || b === -1) {
      selectedUids = new Set([toUid]);
      lastClickedUid = toUid;
      paintSelection();
      syncButtons();
      return;
    }

    const [start, end] = a < b ? [a, b] : [b, a];
    selectedUids = new Set(rowUids.slice(start, end + 1));
    lastClickedUid = toUid;
    paintSelection();
    syncButtons();
  }

  function paintSelection() {
    [...tbody.querySelectorAll("tr")].forEach((r) => {
      const uid = r.dataset.uid;
      if (uid && selectedUids.has(uid)) r.classList.add("is-selected");
      else r.classList.remove("is-selected");
    });
  }

  // ── Modal ──

  function applyPlazoRules() {
    const isByDays = selPlazoTipo.value === "dias";
    plazoDiasWrap.style.display = isByDays ? "" : "none";
    if (!isByDays) inpPlazoDias.value = "1";
  }

  function applyFacturadoRule() {
    const pm = selPaymentMethod.value;
    if (pm === "especie_productora") return; // especie maneja su propio bloqueo
    if (!chkFacturado.checked) {
      selIvaTipo.value = "0";
      selIvaTipo.disabled = true;
    } else {
      selIvaTipo.disabled = false;
      if (selIvaTipo.value === "0" || selIvaTipo.value === "exento") selIvaTipo.value = "16";
    }
  }

  function applyPaymentMethodRulesToModal() {
    const pm = selPaymentMethod.value;
    const isEspecie = pm === "especie_productora";
    if (isEspecie) {
      chkFacturado.checked = false;
      chkFacturado.disabled = true;
      selIvaTipo.value = "0";
      selIvaTipo.disabled = true;
    } else {
      chkFacturado.disabled = false;
      // Delegar bloqueo de IVA al estado de facturado
      applyFacturadoRule();
    }
  }

  function clampInput(inputEl, minValue, integerOnly) {
    const raw = (inputEl.value ?? "").toString().trim();
    if (!raw) return;
    let n = Number(raw);
    if (!Number.isFinite(n)) n = minValue;
    if (integerOnly) n = Math.floor(n);
    if (n < minValue) n = minValue;
    inputEl.value = integerOnly ? String(parseInt(n, 10)) : String(round2(n));
  }

  function openModal(mode) {
    modalMode = mode;
    validationMsg.style.display = "none";
    validationMsg.textContent = "";

    if (mode === "create") {
      modalTitle.textContent = "Crear partida";
      selEtapa.value = ETAPAS[0];
      inpConcepto.value = "";
      selCuenta.value = CUENTAS[0];
      inpEntidad.value = "";
      selPaymentMethod.value = "transferencia";
      chkFacturado.checked = false;
      chkFacturado.disabled = false;
      selIvaTipo.value = "0";
      selIvaTipo.disabled = true;
      inpMonto.value = "";
      inpCantidad.value = "1";
      selPlazoTipo.value = "proyecto";
      inpPlazoDias.value = "1";
      applyPlazoRules();
      applyPaymentMethodRulesToModal();
    } else {
      if (selectedUids.size !== 1) return;
      const onlyUid = [...selectedUids][0];
      const it = items.find((x) => x.uid === onlyUid);
      if (!it) return;

      modalTitle.textContent = "Editar partida";
      selEtapa.value = it.etapa || ETAPAS[0];
      inpConcepto.value = it.concepto || "";
      selCuenta.value = it.cuenta || CUENTAS[0];
      inpEntidad.value = it.entidad || "";
      selPaymentMethod.value = it.payment_method || "transferencia";
      chkFacturado.checked = Boolean(it.facturado);
      selIvaTipo.value = String(it.iva_tipo ?? 0);
      inpMonto.value = String(it.monto_unitario ?? "");
      inpCantidad.value = String(it.cantidad ?? 1);
      selPlazoTipo.value = it.plazo_tipo === "dias" ? "dias" : "proyecto";
      inpPlazoDias.value = String(it.plazo_cantidad ?? it.plazo_dias ?? 1);
      applyPlazoRules();
      applyPaymentMethodRulesToModal();
    }

    modalBackdrop.style.display = "flex";
  }

  function closeModal() {
    modalBackdrop.style.display = "none";
  }

  function validateForm() {
    const concepto = inpConcepto.value.trim();
    if (!concepto) return "Falta: Concepto.";

    const monto = toPositiveNumber(inpMonto.value, 0.01);
    if (!(monto > 0)) return "Monto debe ser mayor a 0.";

    const cantidad = parseInt(inpCantidad.value || "1", 10);
    if (!Number.isFinite(cantidad) || cantidad < 1) return "Cantidad debe ser 1 o mayor.";

    const cuenta = (selCuenta.value || "").trim();
    if (!cuenta) return "Falta: Cuenta.";

    if (selPlazoTipo.value === "dias") {
      const dias = parseInt(inpPlazoDias.value || "1", 10);
      if (!Number.isFinite(dias) || dias < 1) return "Días debe ser 1 o mayor.";
    }

    return null;
  }

  async function saveModal() {
    clampInput(inpMonto, 0.01, false);
    clampInput(inpCantidad, 1, true);

    const err = validateForm();
    if (err) {
      validationMsg.textContent = err;
      validationMsg.style.display = "block";
      return;
    }

    const etapa = selEtapa.value || ETAPAS[0];
    const cuenta = (selCuenta.value || CUENTAS[0]).trim();
    const entidad = inpEntidad.value.trim();
    const payment_method = selPaymentMethod.value || "transferencia";
    const isEspecie = payment_method === "especie_productora";
    const facturado = isEspecie ? false : chkFacturado.checked;
    // Regla: especie→exento | sin factura→0 | con factura→selector
    const iva_tipo = isEspecie ? "exento" : (!facturado ? 0 : (normalizeIvaTipo(selIvaTipo.value) ?? 16));
    const monto_unitario = toPositiveNumber(inpMonto.value, 0.01);
    let cantidad = parseInt(inpCantidad.value || "1", 10);
    if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;
    const plazo_tipo = selPlazoTipo.value === "dias" ? "dias" : "proyecto";
    const plazo_cantidad = plazo_tipo === "dias"
      ? Math.max(1, parseInt(inpPlazoDias.value || "1", 10) || 1)
      : 1;

    if (modalMode === "create") {
      const item = normalizeItem({
        uid: mkUid(),
        etapa,
        concepto: inpConcepto.value.trim(),
        cuenta,
        entidad,
        payment_method,
        facturado,
        monto_unitario,
        cantidad,
        iva_tipo,
        plazo_tipo,
        plazo_cantidad,
      });

      items.push(item);
      await saveItemsAsync();
      renderAll();

      selectedUids = new Set([item.uid]);
      lastClickedUid = item.uid;
      paintSelection();
      syncButtons();
      closeModal();
      return;
    }

    if (selectedUids.size !== 1) return;
    const onlyUid = [...selectedUids][0];
    const idx = items.findIndex((x) => x.uid === onlyUid);
    if (idx === -1) return;

    items[idx] = normalizeItem({
      ...items[idx],
      etapa,
      concepto: inpConcepto.value.trim(),
      cuenta,
      entidad,
      payment_method,
      facturado,
      monto_unitario,
      cantidad,
      iva_tipo,
      plazo_tipo,
      plazo_cantidad,
      updatedAt: Date.now(),
    });

    await saveItemsAsync();
    renderAll();

    selectedUids = new Set([items[idx].uid]);
    lastClickedUid = items[idx].uid;
    paintSelection();
    syncButtons();
    closeModal();
  }

  async function deleteSelected() {
    const n = selectedUids.size;
    if (n === 0) return;

    if (n === 1) {
      const uid = [...selectedUids][0];
      const it = items.find((x) => x.uid === uid);
      const ok = confirm(`¿Eliminar "${it?.concepto || "partida"}"?`);
      if (!ok) return;
      items = items.filter((x) => x.uid !== uid);
      selectedUids.clear();
      lastClickedUid = null;
      await saveItemsAsync();
      renderAll();
      return;
    }

    const ok = confirm(`¿Eliminar ${n} partidas seleccionadas?`);
    if (!ok) return;
    const toDelete = new Set(selectedUids);
    items = items.filter((x) => !toDelete.has(x.uid));
    selectedUids.clear();
    lastClickedUid = null;
    await saveItemsAsync();
    renderAll();
  }

  // ── CSV export ──

  function csvEscape(v) {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCSV() {
    const headers = [
      "etapa",
      "concepto",
      "cuenta",
      "entidad",
      "payment_method",
      "facturado",
      "monto_unitario",
      "cantidad",
      "plazo_tipo",
      "plazo_cantidad",
      "iva_tipo",
      "subtotal",
      "iva_monto",
      "total",
    ];
    const rows = items.map((it) => headers.map((h) => csvEscape(it[h] ?? "")).join(","));
    const csv = [headers.join(","), ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "presupuesto_productora.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Carga masiva ──

  async function loadBulkFromFile() {
    const file = bulkFile?.files?.[0];
    if (!file) {
      alert("Selecciona un archivo .CSV o .XLSX");
      return;
    }

    const name = (file.name || "").toLowerCase();
    const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls");

    try {
      if (isXlsx) {
        const buf = await file.arrayBuffer();
        const rows = await parseXlsxBudgetRows(buf);
        if (!rows.length) {
          alert("El archivo no contiene filas válidas.");
          return;
        }
        bulkText.value = rowsToTSV(rows, true);
        previewBulk();
        return;
      }

      const text = await file.text();
      const rows = parseCSVToRows(text);
      const normed = mapRowsToBudgetLayout(rows);
      if (!normed.length) {
        alert("El CSV no contiene filas válidas (revisa encabezados y datos).");
        return;
      }
      bulkText.value = rowsToTSV(normed, true);
      previewBulk();
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  function downloadBulkTemplateCSV() {
    const headers = [
      "ETAPA", "CONCEPTO", "CUENTA", "ENTIDAD",
      "PAYMENT_METHOD", "FACTURADO", "MONTO", "CANTIDAD", "IVA_TIPO",
    ];
    const sample = [
      "PREPRODUCCIÓN", "Renta cámara", "EQUIPO DE CÁMARA", "Proveedor XYZ",
      "transferencia", "false", "5000", "1", "16",
    ];
    const csv = [headers.join(","), sample.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_presupuesto_productora.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function rowsToTSV(rows, includeHeader) {
    const header = [
      "ETAPA", "CONCEPTO", "CUENTA", "ENTIDAD",
      "PAYMENT_METHOD", "FACTURADO", "MONTO", "CANTIDAD", "IVA_TIPO",
    ];
    const lines = [];
    if (includeHeader) lines.push(header.join("\t"));
    for (const r of rows) {
      lines.push([
        r.etapa, r.concepto, r.cuenta, r.entidad,
        r.payment_method, String(r.facturado ?? false),
        String(r.monto), String(r.cantidad), String(r.iva_tipo ?? 16),
      ].join("\t"));
    }
    return lines.join("\n");
  }

  async function parseXlsxBudgetRows(arrayBuffer) {
    const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames.includes("layout") ? "layout" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

    let headerRowIdx = -1;
    let colIdx = {};

    for (let i = 0; i < Math.min(20, grid.length); i++) {
      const row = (grid[i] || []).map((v) => norm(v));
      const hit = row.includes("ETAPA") && row.includes("CONCEPTO") && row.includes("CUENTA");
      if (hit) {
        headerRowIdx = i;
        row.forEach((h, j) => { if (h) colIdx[h] = j; });
        break;
      }
    }

    if (headerRowIdx === -1) return [];

    const get = (row, key) => {
      const j = colIdx[key];
      if (j === undefined) return "";
      return (row[j] ?? "").toString().trim();
    };

    const out = [];
    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const etapa = get(row, "ETAPA");
      const concepto = get(row, "CONCEPTO");
      const cuenta = get(row, "CUENTA");
      const entidad = get(row, "ENTIDAD");
      // Acepta PAYMENT_METHOD o alias legacy FORMA_PAGO / FORMA
      const pm = get(row, "PAYMENT_METHOD") || get(row, "FORMA_PAGO") || get(row, "FORMA");
      const facturado = get(row, "FACTURADO");
      const monto = get(row, "MONTO");
      const cantidad = get(row, "CANTIDAD");
      const iva_tipo = get(row, "IVA_TIPO") || get(row, "IVA");

      const allEmpty = [etapa, concepto, cuenta, pm, monto].every((x) => !x);
      if (allEmpty) continue;

      out.push({ etapa, concepto, cuenta, entidad, payment_method: pm, facturado, monto, cantidad: cantidad || "1", iva_tipo: iva_tipo || "16" });
    }

    return mapRowsToBudgetLayout([
      ["ETAPA", "CONCEPTO", "CUENTA", "ENTIDAD", "PAYMENT_METHOD", "FACTURADO", "MONTO", "CANTIDAD", "IVA_TIPO"],
      ...out.map((o) => [o.etapa, o.concepto, o.cuenta, o.entidad, o.payment_method, o.facturado, o.monto, o.cantidad, o.iva_tipo]),
    ]);
  }

  function parseCSVToRows(text) {
    const s = (text || "").replace(/^\uFEFF/, ""); // BOM
    const firstLine = s.split(/\r?\n/)[0] || "";
    const sep = detectCsvSeparator(firstLine);

    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else {
          cur += ch;
        }
        continue;
      }

      if (ch === '"') { inQuotes = true; continue; }
      if (ch === sep) { row.push(cur.trim()); cur = ""; continue; }
      if (ch === "\n") { row.push(cur.trim()); rows.push(row); row = []; cur = ""; continue; }
      if (ch === "\r") continue;
      cur += ch;
    }

    row.push(cur.trim());
    rows.push(row);
    return rows.filter((r) => r.some((c) => (c ?? "").toString().trim() !== ""));
  }

  function detectCsvSeparator(line) {
    let inQ = false;
    let comma = 0, semi = 0;
    for (let i = 0; i < (line || "").length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      if (inQ) continue;
      if (ch === ",") comma++;
      if (ch === ";") semi++;
    }
    return semi > comma ? ";" : ",";
  }

  // Mapa de columnas desde CSV/TSV → objeto interno
  function mapRowsToBudgetLayout(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const header = (rows[0] || []).map((h) => norm(h));
    const hasHeader = header.includes("ETAPA") || header.includes("CONCEPTO");
    const start = hasHeader ? 1 : 0;

    const idx = {};
    if (hasHeader) header.forEach((h, i) => { if (h) idx[h] = i; });

    const get = (r, key, fallbackIndex) => {
      const i = idx[key];
      const v = (i !== undefined ? r[i] : r[fallbackIndex]) ?? "";
      return v.toString().trim();
    };

    const out = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [];
      const etapa = get(r, "ETAPA", 0);
      const concepto = get(r, "CONCEPTO", 1);
      const cuenta = get(r, "CUENTA", 2);
      const entidad = get(r, "ENTIDAD", 3);
      // Acepta PAYMENT_METHOD (nuevo) o FORMA_PAGO / FORMA (legacy)
      const pm = get(r, "PAYMENT_METHOD", 4) || get(r, "FORMA_PAGO", 4) || get(r, "FORMA", 4);
      const facturado = get(r, "FACTURADO", 5);
      const monto = get(r, "MONTO", 6);
      const cantidad = get(r, "CANTIDAD", 7);
      const iva_tipo = get(r, "IVA_TIPO", 8) || get(r, "IVA", 8);

      const allEmpty = [etapa, concepto, cuenta, pm, monto].every((x) => !x);
      if (allEmpty) continue;

      out.push({
        etapa,
        concepto,
        cuenta,
        entidad,
        payment_method: pm,
        facturado,
        monto,
        cantidad: cantidad || "1",
        iva_tipo: iva_tipo || "16",
      });
    }

    return out;
  }

  function openBulkModal() {
    bulkParsed = [];
    bulkTbody.innerHTML = "";
    bulkErrors.style.display = "none";
    bulkErrors.textContent = "";
    bulkCommit.disabled = true;
    bulkCommit.textContent = "Agregar 0 partidas";
    bulkBackdrop.style.display = "flex";
  }

  function closeBulkModal() {
    bulkBackdrop.style.display = "none";
  }

  function previewBulk() {
    const raw = (bulkText.value || "").trim();
    bulkParsed = [];
    bulkTbody.innerHTML = "";
    bulkErrors.style.display = "none";
    bulkErrors.textContent = "";
    bulkCommit.disabled = true;
    bulkCommit.textContent = "Agregar 0 partidas";

    if (!raw) {
      showBulkErrors(["Pega al menos 1 fila (puede incluir encabezado)."]);
      return;
    }

    const parsed = parseBulkText(raw);
    if (parsed.errors.length) {
      showBulkErrors(parsed.errors);
      return;
    }

    bulkParsed = parsed.items;
    renderBulkPreview(bulkParsed);
    bulkCommit.disabled = bulkParsed.length === 0;
    bulkCommit.textContent = `Agregar ${bulkParsed.length} partidas`;
  }

  async function commitBulk() {
    if (!bulkParsed.length) return;

    const start = Number.isFinite(seq) ? seq : 0;

    const withIds = bulkParsed.map((it) =>
      normalizeItem({
        uid: mkUid(),
        ...it,
      })
    );

    seq = start + withIds.length;
    items.push(...withIds);

    await saveItemsAsync();
    renderAll();
    closeBulkModal();
  }

  function showBulkErrors(list) {
    bulkErrors.style.display = "block";
    bulkErrors.innerHTML = `
      <div style="color:#ffb4b4;"><b>Errores:</b></div>
      <ul style="margin:6px 0 0 18px;">
        ${list.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
      </ul>
    `;
  }

  function renderBulkPreview(list) {
    bulkTbody.innerHTML = "";
    list.slice(0, 150).forEach((it, idx) => {
      const n = normalizeItem({ uid: "x", ...it });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(n.etapa)}</td>
        <td>${escapeHtml(n.concepto)}</td>
        <td>${escapeHtml(n.cuenta)}</td>
        <td>${escapeHtml(n.entidad)}</td>
        <td>${escapeHtml(labelPaymentMethod(n.payment_method))}</td>
        <td>${n.facturado ? "Sí" : "—"}</td>
        <td>${money(n.monto_unitario)}</td>
        <td>${escapeHtml(String(n.cantidad))}</td>
        <td>${escapeHtml(labelIvaTipo(n.iva_tipo))}</td>
        <td><b>${money(n.total)}</b></td>
      `;
      bulkTbody.appendChild(tr);
    });

    if (list.length > 150) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="11" class="muted"><b>Nota:</b> solo se muestran 150 filas en preview, pero se agregarán todas.</td>`;
      bulkTbody.appendChild(tr);
    }
  }

  function parseBulkText(text) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));

    const header = rows[0].map((h) => norm(h));
    const hasHeader = header.includes("ETAPA") || header.includes("CONCEPTO");
    const start = hasHeader ? 1 : 0;

    const errors = [];
    const itemsOut = [];

    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;

      if (r.length < 7) {
        errors.push(`Fila ${rowNum}: faltan columnas (se esperan al menos 7).`);
        continue;
      }

      const etapa = normalizeEtapa(r[0]);
      const concepto = (r[1] || "").trim();
      const cuenta = normalizeCuenta(r[2]);
      const entidad = (r[3] || "").trim();

      // payment_method: acepta nuevo o legacy (forma_pago viejo)
      const pmRaw = normalizePaymentMethod(r[4]);
      const facturado = normalizeFacturado(r[5]);
      const monto = toPositiveNumber(r[6], 0.01);
      const cantidad = parseInt(r[7] || "1", 10);
      const iva_tipo = normalizeIvaTipo(r[8] || "16");

      if (!etapa) errors.push(`Fila ${rowNum}: ETAPA inválida "${r[0]}".`);
      if (!concepto) errors.push(`Fila ${rowNum}: CONCEPTO vacío.`);
      if (!cuenta) errors.push(`Fila ${rowNum}: CUENTA fuera de catálogo "${r[2]}".`);
      if (!pmRaw) errors.push(`Fila ${rowNum}: PAYMENT_METHOD inválido "${r[4]}". Usa transferencia/efectivo/especie_productora.`);
      if (!(monto > 0)) errors.push(`Fila ${rowNum}: MONTO debe ser > 0.`);
      if (!Number.isFinite(cantidad) || cantidad < 1) errors.push(`Fila ${rowNum}: CANTIDAD debe ser >= 1.`);

      const payment_method = pmRaw || "transferencia";
      const isEspecie = payment_method === "especie_productora";
      const resolvedIvaTipo = isEspecie ? "exento" : (iva_tipo ?? 16);
      const resolvedFacturado = isEspecie ? false : (facturado ?? false);

      const thisRowHasError = errors.some((e) => e.startsWith(`Fila ${rowNum}:`));
      if (!thisRowHasError) {
        itemsOut.push({
          etapa,
          concepto,
          cuenta,
          entidad,
          payment_method,
          facturado: resolvedFacturado,
          monto_unitario: monto,
          cantidad,
          iva_tipo: resolvedIvaTipo,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    return { items: itemsOut, errors };
  }
}

/* =======================
  Helpers globales (fuera del closure)
======================= */
function round2(n) {
  return Math.round(n * 100) / 100;
}

function toPositiveNumber(v, min) {
  const s = (v ?? "").toString().replace(/[$,]/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n;
}

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', "&quot;");
}

function norm(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
