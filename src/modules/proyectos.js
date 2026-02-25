/* =========================================================
   src/modules/proyectos.js
   Gestión de proyectos de la organización.

   ✅ Lista proyectos de la org
   ✅ Crear nuevo proyecto
   ✅ Seleccionar proyecto activo (persiste en localStorage)
   ✅ Editar / Eliminar proyecto
   ✅ Badge de estado con colores
========================================================= */

import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  ESTADOS_PROYECTO,
  MONEDAS,
} from "../services/proyectosService.js";

const LS_ACTIVE_PROJECT = "ACTIVE_PROJECT_ID";

// ─── Helper: persistir proyecto activo ───────────────────
export function setActiveProject(project) {
  window.appState.project = project || null;
  if (project?.id) {
    localStorage.setItem(LS_ACTIVE_PROJECT, project.id);
  } else {
    localStorage.removeItem(LS_ACTIVE_PROJECT);
  }
  // Dispara evento para que main.js actualice el topbar
  window.dispatchEvent(new CustomEvent("project-changed", { detail: project }));
}

export function getActiveProjectId() {
  return localStorage.getItem(LS_ACTIVE_PROJECT) || null;
}

// ─── Estado badge ─────────────────────────────────────────
function estadoBadge(estado) {
  const map = {
    desarrollo:    { label: "Desarrollo",    color: "#4f7cff" },
    preproduccion: { label: "Preproducción", color: "#f4b740" },
    produccion:    { label: "Producción",    color: "#38c172" },
    posproduccion: { label: "Posproducción", color: "#a855f7" },
    entrega:       { label: "Entrega",       color: "#e05555" },
  };
  const s = map[estado] || { label: estado, color: "#888" };
  return `<span class="badge-estado" style="background:${s.color}22;border:1px solid ${s.color}55;color:${s.color};">${escapeHtml(s.label)}</span>`;
}

// ─── RENDER PRINCIPAL ─────────────────────────────────────
export function renderProyectosView() {
  const estadosOptions = ESTADOS_PROYECTO.map(
    (e) => `<option value="${e.value}">${e.label}</option>`
  ).join("");

  const monedasOptions = MONEDAS.map(
    (m) => `<option value="${m.value}">${m.label}</option>`
  ).join("");

  return `
    <div class="container" style="padding-top:18px;">

      <!-- Header -->
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:18px;">
        <div>
          <h2 style="margin:0;">Proyectos</h2>
          <p class="muted" style="margin:4px 0 0;">Selecciona o crea un proyecto para empezar.</p>
        </div>
        <button id="btnAbrirCrear" class="btn btn-primary">+ Nuevo proyecto</button>
      </div>

      <!-- Mensaje de estado -->
      <div id="proyMsg" style="display:none;margin-bottom:14px;"></div>

      <!-- Lista de proyectos -->
      <div id="proyLista"></div>

      <!-- Modal Crear / Editar -->
      <div id="proyModalBackdrop" class="modal-backdrop" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 id="proyModalTitulo">Nuevo proyecto</h3>
            <button id="proyModalClose" class="modal-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <label style="grid-column:1/-1;">
                <span>Nombre del proyecto *</span>
                <input id="proyNombre" type="text" placeholder="Ej. Documental IMCINE 2025" />
              </label>
              <label style="grid-column:1/-1;">
                <span>Descripción</span>
                <input id="proyDesc" type="text" placeholder="Breve descripción opcional" />
              </label>
              <label>
                <span>Estado</span>
                <select id="proyEstado">${estadosOptions}</select>
              </label>
              <label>
                <span>Moneda</span>
                <select id="proyMoneda">${monedasOptions}</select>
              </label>
              <label>
                <span>Fecha de inicio</span>
                <input id="proyFechaInicio" type="date" />
              </label>
              <label>
                <span>Fecha de entrega</span>
                <input id="proyFechaFin" type="date" />
              </label>
            </div>
            <p id="proyValidMsg" class="error" style="display:none;margin-top:10px;"></p>
          </div>
          <div class="modal-footer">
            <button id="proyModalCancel" class="btn btn-ghost">Cancelar</button>
            <button id="proyModalSave" class="btn btn-primary">Guardar</button>
          </div>
        </div>
      </div>

    </div>
  `;
}

// ─── BIND EVENTS ──────────────────────────────────────────
export async function bindProyectosEvents() {
  const lista     = document.getElementById("proyLista");
  const msgEl     = document.getElementById("proyMsg");
  const backdrop  = document.getElementById("proyModalBackdrop");
  const titulo    = document.getElementById("proyModalTitulo");
  const btnAbrir  = document.getElementById("btnAbrirCrear");
  const btnClose  = document.getElementById("proyModalClose");
  const btnCancel = document.getElementById("proyModalCancel");
  const btnSave   = document.getElementById("proyModalSave");
  const inpNombre = document.getElementById("proyNombre");
  const inpDesc   = document.getElementById("proyDesc");
  const selEstado = document.getElementById("proyEstado");
  const selMoneda = document.getElementById("proyMoneda");
  const inpFechaI = document.getElementById("proyFechaInicio");
  const inpFechaF = document.getElementById("proyFechaFin");
  const validMsg  = document.getElementById("proyValidMsg");

  let modalMode = "create"; // "create" | "edit"
  let editingId = null;

  // ── helpers ──
  function showMsg(text, isError = false) {
    msgEl.style.display = "block";
    msgEl.className = isError ? "error" : "ok";
    msgEl.textContent = text;
    setTimeout(() => { msgEl.style.display = "none"; }, 4000);
  }

  function openModal(mode, project = null) {
    modalMode = mode;
    editingId = project?.id || null;
    validMsg.style.display = "none";

    if (mode === "edit" && project) {
      titulo.textContent = "Editar proyecto";
      inpNombre.value = project.name || "";
      inpDesc.value = project.descripcion || "";
      selEstado.value = project.estado || "desarrollo";
      selMoneda.value = project.moneda || "MXN";
      inpFechaI.value = project.fecha_inicio || "";
      inpFechaF.value = project.fecha_fin || "";
    } else {
      titulo.textContent = "Nuevo proyecto";
      inpNombre.value = "";
      inpDesc.value = "";
      selEstado.value = "desarrollo";
      selMoneda.value = "MXN";
      inpFechaI.value = "";
      inpFechaF.value = "";
    }

    backdrop.style.display = "flex";
    inpNombre.focus();
  }

  function closeModal() {
    backdrop.style.display = "none";
  }

  // ── render lista ──
  async function loadAndRender() {
    lista.innerHTML = `<p class="muted" style="padding:14px;">Cargando proyectos…</p>`;
    try {
      const projects = await getProjects();
      renderLista(projects);
    } catch (e) {
      lista.innerHTML = `<div class="error" style="margin:0;">${escapeHtml(e?.message || String(e))}</div>`;
    }
  }

  function renderLista(projects) {
    if (!projects.length) {
      lista.innerHTML = `
        <div class="card" style="text-align:center;padding:36px;">
          <p style="font-size:16px;margin:0 0 10px;">No hay proyectos aún.</p>
          <p class="muted" style="margin:0 0 16px;">Crea tu primer proyecto para comenzar.</p>
          <button class="btn btn-primary" id="btnCrearPrimero">+ Crear proyecto</button>
        </div>
      `;
      document.getElementById("btnCrearPrimero")?.addEventListener("click", () => openModal("create"));
      return;
    }

    const activeId = window.appState?.project?.id || null;

    lista.innerHTML = projects.map(p => `
      <div class="proyecto-card ${p.id === activeId ? "is-active" : ""}" data-id="${p.id}">
        <div class="proyecto-card-left">
          <div class="proyecto-card-name">${escapeHtml(p.name)}</div>
          ${p.descripcion ? `<div class="muted" style="font-size:12px;margin-top:2px;">${escapeHtml(p.descripcion)}</div>` : ""}
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${estadoBadge(p.estado)}
            <span class="muted" style="font-size:12px;">${escapeHtml(p.moneda)}</span>
            ${p.fecha_inicio ? `<span class="muted" style="font-size:12px;">${escapeHtml(p.fecha_inicio)} → ${escapeHtml(p.fecha_fin || "…")}</span>` : ""}
          </div>
        </div>
        <div class="proyecto-card-actions">
          ${p.id === activeId
            ? `<span class="badge-activo">● Activo</span>`
            : `<button class="btn btn-primary btn-xs" data-action="select" data-id="${p.id}">Seleccionar</button>`
          }
          <button class="btn btn-ghost btn-xs" data-action="edit" data-id="${p.id}">Editar</button>
          <button class="btn btn-danger btn-xs" data-action="delete" data-id="${p.id}">Eliminar</button>
        </div>
      </div>
    `).join("");

    // Bind action buttons
    lista.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const project = projects.find(p => p.id === id);

        if (action === "select") {
          setActiveProject(project);
          showMsg(`Proyecto "${project.name}" seleccionado.`);
          renderLista(projects);
        }

        if (action === "edit") {
          openModal("edit", project);
        }

        if (action === "delete") {
          if (!confirm(`¿Eliminar el proyecto "${project.name}"? Esta acción no se puede deshacer.`)) return;
          try {
            await deleteProject(id);
            if (window.appState?.project?.id === id) {
              setActiveProject(null);
            }
            showMsg("Proyecto eliminado.");
            await loadAndRender();
          } catch (e) {
            showMsg(e?.message || String(e), true);
          }
        }
      });
    });
  }

  // ── modal save ──
  btnSave.addEventListener("click", async () => {
    validMsg.style.display = "none";
    const name = inpNombre.value.trim();
    if (!name) {
      validMsg.textContent = "El nombre del proyecto es obligatorio.";
      validMsg.style.display = "block";
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = "Guardando…";

    try {
      if (modalMode === "create") {
        const proj = await createProject({
          name,
          descripcion: inpDesc.value.trim(),
          moneda: selMoneda.value,
          estado: selEstado.value,
          fecha_inicio: inpFechaI.value || null,
          fecha_fin: inpFechaF.value || null,
        });
        setActiveProject(proj);
        showMsg(`Proyecto "${proj.name}" creado y seleccionado.`);
      } else {
        const proj = await updateProject(editingId, {
          name,
          descripcion: inpDesc.value.trim(),
          moneda: selMoneda.value,
          estado: selEstado.value,
          fecha_inicio: inpFechaI.value || null,
          fecha_fin: inpFechaF.value || null,
        });
        // Actualizar appState si era el activo
        if (window.appState?.project?.id === editingId) {
          setActiveProject(proj);
        }
        showMsg(`Proyecto actualizado.`);
      }
      closeModal();
      await loadAndRender();
    } catch (e) {
      validMsg.textContent = e?.message || String(e);
      validMsg.style.display = "block";
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Guardar";
    }
  });

  // ── otros binds ──
  btnAbrir.addEventListener("click", () => openModal("create"));
  btnClose.addEventListener("click", closeModal);
  btnCancel.addEventListener("click", closeModal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });

  // ── init ──
  await loadAndRender();
}

// ─── utilidades ───────────────────────────────────────────
function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
