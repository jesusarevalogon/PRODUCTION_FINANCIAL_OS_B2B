/* =========================================================
   src/modules/ejecucion.js
   Vista Ejecución vs Presupuesto — El momento "WOW".

   ✅ Requiere proyecto activo
   ✅ Carga partidas aprobadas desde project_state (presupuesto)
   ✅ Carga gastos reales desde tabla expenses
   ✅ Por cuenta: Aprobado | Ejecutado | Disponible | % ejecución
   ✅ Semáforos:  Verde <70% | Amarillo 70-90% | Rojo ≥90%
   ✅ Fila de totales generales
   ✅ Exportar resumen a PDF
========================================================= */

import { loadModuleState } from "../services/stateService.js";
import { getExpenses } from "../services/gastosService.js";

// ─── semáforo ─────────────────────────────────────────────
function semaforo(pct) {
  if (pct >= 100) return { color: "#e05555", label: "EXCEDIDO",   emoji: "🔴" };
  if (pct >= 90)  return { color: "#e05555", label: "CRÍTICO",    emoji: "🔴" };
  if (pct >= 70)  return { color: "#f4b740", label: "ATENCIÓN",   emoji: "🟡" };
  return               { color: "#38c172", label: "OK",          emoji: "🟢" };
}

function fmt(n, moneda = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda }).format(n || 0);
}

function pctBar(pct) {
  const capped = Math.min(pct, 100);
  const s = semaforo(pct);
  return `
    <div class="pct-bar-wrap">
      <div class="pct-bar-track">
        <div class="pct-bar-fill" style="width:${capped}%;background:${s.color};"></div>
      </div>
      <span class="pct-bar-label" style="color:${s.color};">${pct.toFixed(1)}%</span>
    </div>
  `;
}

// ─── RENDER ───────────────────────────────────────────────
export function renderEjecucionView() {
  return `
    <div class="container" style="padding-top:18px;" id="ejecucionRoot">

      <!-- Header -->
      <div class="card" style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;">Ejecución vs Presupuesto</h2>
            <p class="muted" style="margin:4px 0 0;" id="ejecucionProyNombre">Proyecto: cargando…</p>
          </div>
          <div style="display:flex;gap:10px;">
            <button id="ejecucionBtnRefresh" class="btn btn-ghost btn-xs">↻ Actualizar</button>
            <button id="ejecucionBtnExport" class="btn btn-primary">Exportar PDF</button>
          </div>
        </div>
      </div>

      <!-- KPIs globales -->
      <div id="ejecucionKpis" class="ejecucion-kpis" style="margin-bottom:18px;"></div>

      <!-- Leyenda semáforos -->
      <div style="display:flex;gap:18px;margin-bottom:14px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#38c172;display:inline-block;"></span> OK (&lt;70%)
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#f4b740;display:inline-block;"></span> Atención (70–90%)
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#e05555;display:inline-block;"></span> Crítico / Excedido (≥90%)
        </div>
      </div>

      <!-- Tabla principal -->
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:18px;">
        <div class="table-wrap" style="border:none;">
          <table class="table" id="ejecucionTable">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th style="text-align:right;">Aprobado</th>
                <th style="text-align:right;">Ejecutado</th>
                <th style="text-align:right;">Disponible</th>
                <th style="min-width:160px;">Ejecución</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody id="ejecucionTbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Gastos sin cuenta en presupuesto -->
      <div id="ejecucionSinPartida" style="display:none;"></div>

    </div>
  `;
}

// ─── BIND EVENTS ──────────────────────────────────────────
export async function bindEjecucionEvents() {
  // Verificar proyecto activo
  if (!window.appState?.project?.id) {
    const root = document.getElementById("ejecucionRoot");
    if (root) {
      root.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;">
          <h2>Sin proyecto activo</h2>
          <p class="muted">Selecciona un proyecto en la sección <b>Proyectos</b> para ver la ejecución.</p>
          <button class="btn btn-primary" onclick="window.navigateTo('proyectos')">Ir a Proyectos</button>
        </div>
      `;
    }
    return;
  }

  const project = window.appState.project;
  const moneda  = project.moneda || "MXN";

  const proyNombreEl  = document.getElementById("ejecucionProyNombre");
  const kpisEl        = document.getElementById("ejecucionKpis");
  const tbody         = document.getElementById("ejecucionTbody");
  const sinPartidaEl  = document.getElementById("ejecucionSinPartida");
  const btnRefresh    = document.getElementById("ejecucionBtnRefresh");
  const btnExport     = document.getElementById("ejecucionBtnExport");

  if (proyNombreEl) proyNombreEl.textContent = `Proyecto: ${project.name}`;

  // ── Cargar y calcular ──
  async function loadAndRender() {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;color:var(--muted);">Calculando…</td></tr>`;
    if (kpisEl) kpisEl.innerHTML = "";

    try {
      const userId    = window.appState.user?.id;
      const projectId = project.id;

      // 1) Cargar presupuesto aprobado desde project_state
      const budgetState = await loadModuleState({ userId, projectId, moduleKey: "presupuesto" });
      const budgetItems = Array.isArray(budgetState?.items) ? budgetState.items : [];

      // 2) Cargar gastos reales
      const expenses = await getExpenses({ projectId });

      // 3) Agrupar presupuesto por cuenta → total aprobado (total ya incluye IVA)
      const aprobado = {}; // { "LOCACIONES": 50000, ... }
      for (const item of budgetItems) {
        const cuenta = String(item.cuenta || "SIN CUENTA").trim();
        const total  = Number(item.total ?? (Number(item.subtotal || 0) + Number(item.iva || 0)));
        aprobado[cuenta] = (aprobado[cuenta] || 0) + total;
      }

      // 4) Agrupar gastos por cuenta → total ejecutado
      const ejecutado = {}; // { "LOCACIONES": 15000, ... }
      for (const exp of expenses) {
        const cuenta = String(exp.cuenta || "SIN CUENTA").trim();
        ejecutado[cuenta] = (ejecutado[cuenta] || 0) + Number(exp.monto || 0);
      }

      // 5) Unión de cuentas (aparecen en aprobado o en ejecutado)
      const todasCuentas = [...new Set([...Object.keys(aprobado), ...Object.keys(ejecutado)])].sort();

      // 6) Gastos en cuentas sin presupuesto (alerta)
      const sinPresupuesto = Object.keys(ejecutado).filter(c => !aprobado[c]);

      // 7) Render KPIs
      const totalAprobado  = Object.values(aprobado).reduce((s, v) => s + v, 0);
      const totalEjecutado = Object.values(ejecutado).reduce((s, v) => s + v, 0);
      const totalDisponible = totalAprobado - totalEjecutado;
      const pctGlobal = totalAprobado > 0 ? (totalEjecutado / totalAprobado) * 100 : 0;
      const sGlobal   = semaforo(pctGlobal);

      if (kpisEl) {
        kpisEl.innerHTML = `
          <div class="kpi-card">
            <div class="kpi-label">Presupuesto aprobado</div>
            <div class="kpi-value" style="color:var(--primary);">${fmt(totalAprobado, moneda)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total ejecutado</div>
            <div class="kpi-value">${fmt(totalEjecutado, moneda)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Disponible</div>
            <div class="kpi-value" style="color:${totalDisponible < 0 ? '#e05555' : '#38c172'};">
              ${fmt(totalDisponible, moneda)}
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">% Ejecución global</div>
            <div class="kpi-value" style="color:${sGlobal.color};">
              ${pctGlobal.toFixed(1)}% <span style="font-size:18px;">${sGlobal.emoji}</span>
            </div>
          </div>
        `;
      }

      // 8) Render tabla
      if (!todasCuentas.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">
              No hay datos de presupuesto ni gastos para este proyecto.
              <br/><a style="color:var(--primary);cursor:pointer;" onclick="window.navigateTo('presupuesto')">Carga el presupuesto →</a>
            </td>
          </tr>
        `;
      } else {
        const rows = todasCuentas.map(cuenta => {
          const apr  = aprobado[cuenta] || 0;
          const ejec = ejecutado[cuenta] || 0;
          const disp = apr - ejec;
          const pct  = apr > 0 ? (ejec / apr) * 100 : (ejec > 0 ? 999 : 0);
          const s    = semaforo(pct);

          return `
            <tr>
              <td>${escapeHtml(cuenta)}</td>
              <td style="text-align:right;">${fmt(apr, moneda)}</td>
              <td style="text-align:right;font-weight:600;">${fmt(ejec, moneda)}</td>
              <td style="text-align:right;color:${disp < 0 ? '#e05555' : 'inherit'};">${fmt(disp, moneda)}</td>
              <td>${apr > 0 ? pctBar(pct) : '<span class="muted" style="font-size:12px;">Sin aprobado</span>'}</td>
              <td>
                <span class="semaforo-badge" style="background:${s.color}22;border:1px solid ${s.color}55;color:${s.color};">
                  ${s.emoji} ${s.label}
                </span>
              </td>
            </tr>
          `;
        }).join("");

        // Fila de totales
        const pctTotal = totalAprobado > 0 ? (totalEjecutado / totalAprobado) * 100 : 0;
        const sTotal   = semaforo(pctTotal);

        tbody.innerHTML = rows + `
          <tr class="totals-row">
            <td><strong>TOTAL GENERAL</strong></td>
            <td style="text-align:right;"><strong>${fmt(totalAprobado, moneda)}</strong></td>
            <td style="text-align:right;"><strong>${fmt(totalEjecutado, moneda)}</strong></td>
            <td style="text-align:right;color:${totalDisponible < 0 ? '#e05555' : 'var(--ok)'};">
              <strong>${fmt(totalDisponible, moneda)}</strong>
            </td>
            <td>${pctBar(pctTotal)}</td>
            <td>
              <span class="semaforo-badge" style="background:${sTotal.color}22;border:1px solid ${sTotal.color}55;color:${sTotal.color};">
                ${sTotal.emoji} ${sTotal.label}
              </span>
            </td>
          </tr>
        `;
      }

      // 9) Gastos sin partida en presupuesto
      if (sinPartidaEl) {
        if (sinPresupuesto.length) {
          sinPartidaEl.style.display = "block";
          sinPartidaEl.innerHTML = `
            <div class="card" style="border-color:rgba(244,183,64,.3);background:rgba(244,183,64,.05);">
              <h3 style="color:var(--warn);margin:0 0 8px;">⚠ Gastos en cuentas sin presupuesto aprobado</h3>
              <p class="muted" style="margin:0 0 10px;">
                Los siguientes gastos no tienen partida aprobada en el presupuesto:
              </p>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${sinPresupuesto.map(c => `
                  <span style="padding:4px 10px;border-radius:8px;background:rgba(244,183,64,.15);border:1px solid rgba(244,183,64,.3);font-size:12px;color:var(--warn);">
                    ${escapeHtml(c)}: ${fmt(ejecutado[c] || 0, moneda)}
                  </span>
                `).join("")}
              </div>
            </div>
          `;
        } else {
          sinPartidaEl.style.display = "none";
        }
      }

    } catch (e) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="error" style="padding:16px;">${escapeHtml(e?.message || String(e))}</td></tr>`;
      }
    }
  }

  // ── Exportar PDF ──
  btnExport?.addEventListener("click", async () => {
    btnExport.disabled = true;
    btnExport.textContent = "Generando PDF…";
    try {
      await exportEjecucionPdf(project);
    } catch (e) {
      alert("Error al generar PDF: " + (e?.message || String(e)));
    } finally {
      btnExport.disabled = false;
      btnExport.textContent = "Exportar PDF";
    }
  });

  btnRefresh?.addEventListener("click", () => loadAndRender());

  // ── Init ──
  await loadAndRender();
}

// ─── Export PDF ───────────────────────────────────────────
async function exportEjecucionPdf(project) {
  const [{ default: html2canvas }, jsPdfMod] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
    import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm"),
  ]);

  const jsPDF = jsPdfMod.jsPDF || jsPdfMod.default?.jsPDF || jsPdfMod.default || jsPdfMod;
  const moneda = project.moneda || "MXN";

  // Tomar datos actuales del DOM
  const table = document.getElementById("ejecucionTable");
  const kpis  = document.getElementById("ejecucionKpis");
  if (!table) throw new Error("No se encontró la tabla de ejecución.");

  const today = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 30px; background: #fff; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .sub { color: #666; font-size: 13px; margin: 0 0 24px; }
      .kpis { display: flex; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
      .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 12px 18px; min-width: 140px; }
      .kpi-label { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
      .kpi-value { font-size: 18px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { background: #1f2a44; color: #fff; padding: 10px 12px; text-align: left; font-size: 11px; }
      th:not(:first-child) { text-align: right; }
      td { padding: 9px 12px; border-bottom: 1px solid #eee; }
      td:not(:first-child) { text-align: right; }
      tr:nth-child(even) { background: #f9f9f9; }
      .total-row { background: #1f2a44 !important; color: #fff; font-weight: 700; }
      .total-row td { color: #fff; border: none; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    </style>
    </head><body>
    <h1>Reporte de Ejecución — ${escapeHtml(project.name)}</h1>
    <p class="sub">Fecha de corte: ${today} | Moneda: ${escapeHtml(moneda)}</p>
    <div class="kpis">${document.getElementById("ejecucionKpis")?.innerHTML || ""}</div>
    ${table.outerHTML}
    </body></html>
  `;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-99999px;top:0;width:1200px;height:900px;opacity:0;";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    doc.open(); doc.write(html); doc.close();
    await new Promise(r => setTimeout(r, 400));
    try { await doc.fonts?.ready; } catch {}

    const canvas = await html2canvas(doc.body, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      windowWidth: 1200,
    });

    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const usableW = pw - margin * 2;
    const imgH = (canvas.height / canvas.width) * usableW;
    const scale2 = imgH <= (ph - margin * 2) ? 1 : (ph - margin * 2) / imgH;

    pdf.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG",
      margin, margin, usableW * scale2, imgH * scale2, undefined, "FAST");

    pdf.save(`Ejecucion_${project.name.replace(/\s+/g, "_")}_${today.replace(/\s/g,"_")}.pdf`);
  } finally {
    iframe.remove();
  }
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
