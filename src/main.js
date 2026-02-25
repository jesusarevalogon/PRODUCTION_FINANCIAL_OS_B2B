// src/main.js
import { initRouter, navigate } from "./router.js";
import { supabase } from "./services/supabase.js";
import { getProjectById } from "./services/proyectosService.js";
import { getActiveProjectId, setActiveProject } from "./modules/proyectos.js";

const app = document.getElementById("app");

// ── Estado global ────────────────────────────────────────
window.appState = {
  user: null,
  profile: null,
  organization: null,
  project: null,
};

window.navigateTo = (route) => navigate(route);

// ── Auth listener (una sola suscripción) ─────────────────
let _authUnsubscribe = null;
// ── Mutex: evita boots concurrentes ──────────────────────
let _bootInFlight = false;
// ✅ NUEVO: si entra un boot mientras hay otro en vuelo, lo encolamos
let _bootQueued = false;

// ── Helpers UI ───────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[m]));
}

function setBtnLoading(btn, loading, labelWhenDone) {
  if (!btn) return;
  btn.disabled = !!loading;
  if (loading) {
    btn.dataset._label = btn.textContent;
    btn.textContent = "Cargando…";
  } else {
    btn.textContent = labelWhenDone || btn.dataset._label || "Listo";
    delete btn.dataset._label;
  }
}

function ensureSupabase() {
  if (!supabase) {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h2>Error de configuración</h2>
          <p class="error">No se inicializó Supabase.</p>
          <p class="muted">Revisa <code>src/services/supabase.js</code>.</p>
        </div>
      </div>`;
    throw new Error("[main] supabase no inicializado");
  }
}

// ── Topbar ───────────────────────────────────────────────
function renderTopBar(activeRoute = "") {
  const orgName  = window.appState.organization?.name || "(sin org)";
  const projName = window.appState.project?.name;
  const email    = window.appState.user?.email || "";

  const navLinks = [
    { route: "",          label: "Home" },
    { route: "proyectos", label: "Proyectos" },
    { route: "presupuesto", label: "Presupuesto" },
    { route: "gastos",    label: "Gastos" },
    { route: "ejecucion", label: "Ejecución" },
  ];

  const navHtml = navLinks.map(n => `
    <button class="nav-link ${activeRoute === n.route ? "nav-link-active" : ""}"
            data-nav="${n.route}">${n.label}</button>
  `).join("");

  return `
    <div class="topbar-main">
      <div class="topbar-inner">
        <div class="topbar-brand">
          <span class="topbar-org">${escapeHtml(orgName)}</span>
          ${projName
            ? `<span class="topbar-sep">›</span><span class="topbar-proj">${escapeHtml(projName)}</span>`
            : `<span class="topbar-sep">›</span><span class="topbar-no-proj" title="Selecciona un proyecto">Sin proyecto</span>`
          }
        </div>

        <nav class="topbar-nav">${navHtml}</nav>

        <div class="topbar-right">
          <span class="muted" style="font-size:12px;white-space:nowrap;">${escapeHtml(email)}</span>
          <button class="btn btn-ghost btn-xs" id="btnLogout">Salir</button>
        </div>
      </div>
    </div>
  `;
}

function bindTopBarEvents(activeRoute = "") {
  // Navegación
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.nav));
  });

  // Logout
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      ensureSupabase();
      window.appState.project = null;
      localStorage.removeItem("ACTIVE_PROJECT_ID");
      try { await supabase.auth.signOut(); } catch {
        try { await supabase.auth.signOut({ scope: "local" }); } catch {}
        renderLogin("Sesión cerrada.");
      }
    });
  }

  // Escuchar cambio de proyecto para actualizar topbar
  window.addEventListener("project-changed", () => {
    const topbarEl = document.querySelector(".topbar-main");
    if (topbarEl) {
      topbarEl.outerHTML = renderTopBar(activeRoute);
      bindTopBarEvents(activeRoute);
    }
  }, { once: true });
}

// ── Auth UI ───────────────────────────────────────────────
function renderLogin(msg = "", isError = false) {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h2>Production Financial OS</h2>
        <div class="small" style="margin-bottom:16px;">Sistema Financiero de Producción Audiovisual</div>

        <form id="loginForm" autocomplete="on">
          <label>Email</label>
          <input id="email" type="email" placeholder="correo@ejemplo.com" autocomplete="email" />
          <label style="margin-top:10px;">Contraseña</label>
          <input id="password" type="password" placeholder="••••••••" autocomplete="current-password" />
          <div style="display:flex;gap:10px;margin-top:14px;">
            <button class="btn btn-primary" id="btnLogin" type="submit" style="flex:1;">Entrar</button>
            <button class="btn btn-ghost" id="btnGoRegister" type="button">Crear cuenta</button>
          </div>
        </form>

        ${msg ? `<div class="${isError ? "error" : "ok"}" style="margin-top:10px;">${escapeHtml(msg)}</div>` : ""}
      </div>
    </div>`;

  document.getElementById("btnGoRegister")?.addEventListener("click", () => renderRegister());

  const form    = document.getElementById("loginForm");
  const btnLogin = document.getElementById("btnLogin");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    ensureSupabase();
    const email    = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!email)    return renderLogin("Escribe tu email.", true);
    if (!password) return renderLogin("Escribe tu contraseña.", true);

    setBtnLoading(btnLogin, true, "Entrar");
    try {
      // ✅ Sin pre-signOut: evita SIGNED_OUT en medio del login
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.warn("[login error]", error.message);
        renderLogin(error.message, true);
        return;
      }
      console.log("[login ok]", data.user?.email);
      renderLogin("Entrando…");
    } catch (err) {
      console.error("[login exception]", err);
      renderLogin("Error inesperado al iniciar sesión.", true);
    } finally {
      setBtnLoading(btnLogin, false, "Entrar");
    }
  });
}

function renderRegister(msg = "", isError = false) {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h2>Production Financial OS</h2>
        <div class="small" style="margin-bottom:16px;">Crear cuenta</div>

        <form id="regForm" autocomplete="on">
          <label>Email</label>
          <input id="email" type="email" placeholder="correo@ejemplo.com" autocomplete="email" />
          <label style="margin-top:10px;">Contraseña (mín. 6 caracteres)</label>
          <input id="password" type="password" placeholder="••••••••" autocomplete="new-password" />
          <label style="margin-top:10px;">Confirmar contraseña</label>
          <input id="password2" type="password" placeholder="••••••••" autocomplete="new-password" />
          <div style="display:flex;gap:10px;margin-top:14px;">
            <button class="btn btn-primary" id="btnCreate" type="submit" style="flex:1;">Crear cuenta</button>
            <button class="btn btn-ghost" id="btnBack" type="button">Volver</button>
          </div>
        </form>

        ${msg ? `<div class="${isError ? "error" : "ok"}" style="margin-top:10px;">${escapeHtml(msg)}</div>` : ""}
      </div>
    </div>`;

  document.getElementById("btnBack")?.addEventListener("click", () => renderLogin());

  const form     = document.getElementById("regForm");
  const btnCreate = document.getElementById("btnCreate");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    ensureSupabase();
    const email     = document.getElementById("email").value.trim();
    const password  = document.getElementById("password").value;
    const password2 = document.getElementById("password2").value;
    if (!email) return renderRegister("Escribe un email.", true);
    if (password.length < 6) return renderRegister("Contraseña mínimo 6 caracteres.", true);
    if (password !== password2) return renderRegister("Las contraseñas no coinciden.", true);

    setBtnLoading(btnCreate, true, "Crear cuenta");
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) { renderRegister(error.message, true); return; }
      try { await supabase.auth.signOut({ scope: "local" }); } catch {}
      renderLogin("✅ Cuenta creada. Ahora inicia sesión.");
    } catch (err) {
      renderRegister("Error inesperado al crear la cuenta.", true);
    } finally {
      setBtnLoading(btnCreate, false, "Crear cuenta");
    }
  });
}

// ── Data loaders ──────────────────────────────────────────
async function loadProfileAndOrg(userId) {
  // ✅ maybeSingle evita 406 si no existe fila
  const { data: profile0, error: pErr0 } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (pErr0) {
    console.warn("[main] No se pudo leer profile:", pErr0.message);
    return { profile: null, organization: null };
  }

  // ✅ Si no existe, lo creamos (usuarios viejos / trigger no corrió)
  let profile = profile0;
  if (!profile) {
    const { error: iErr } = await supabase.from("profiles").insert({ id: userId });
    if (iErr) {
      console.warn("[main] No se pudo crear profile:", iErr.message);
      return { profile: null, organization: null };
    }

    const { data: profile1, error: pErr1 } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (pErr1) {
      console.warn("[main] No se pudo releer profile:", pErr1.message);
      return { profile: null, organization: null };
    }
    profile = profile1;
  }

  let organization = null;
  if (profile?.organization_id) {
    const { data: org, error: oErr } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", profile.organization_id)
      .single();
    if (!oErr) organization = org;
  }

  return { profile, organization };
}

async function tryLoadActiveProject() {
  const savedId = getActiveProjectId();
  if (!savedId || !window.appState.organization?.id) return null;
  try {
    const proj = await getProjectById(savedId);
    return proj || null;
  } catch {
    return null;
  }
}

// ── Onboarding: crear org ─────────────────────────────────
function renderNoOrgScreen() {
  app.innerHTML = `
    <div class="container" style="padding-top:40px;">
      <div class="card" style="max-width:520px;margin:0 auto;">

        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <h2 style="margin:0;">Configura tu organización</h2>
            <div class="muted" style="font-size:12px;margin-top:6px;">
              ${escapeHtml(window.appState?.user?.email || "")}
            </div>
          </div>
          <button class="btn btn-ghost btn-xs" id="btnLogoutOnboard" type="button">Salir</button>
        </div>

        <p class="muted" style="margin-top:14px;">
          Tu cuenta está lista. Ahora necesitas crear o unirte a una organización (productora).
        </p>

        <label style="margin-top:12px;margin-bottom:6px;font-size:12px;color:rgba(255,255,255,.65);">
          Nombre de la organización
        </label>
        <input id="orgName" type="text" placeholder="Ej. Productora Sur S.A." />

        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="btn btn-primary" id="btnCreateOrg">Crear organización</button>
          <button class="btn btn-ghost" id="btnReload">Reintentar</button>
        </div>

        <div id="orgMsg" style="margin-top:10px;"></div>
      </div>
    </div>`;

  document.getElementById("btnLogoutOnboard")?.addEventListener("click", async () => {
    try {
      window.appState.project = null;
      localStorage.removeItem("ACTIVE_PROJECT_ID");
      await supabase.auth.signOut();
      renderLogin("Sesión cerrada.");
    } catch {
      renderLogin("Sesión cerrada.");
    }
  });

  document.getElementById("btnReload")?.addEventListener("click", () => bootAuthed());

  document.getElementById("btnCreateOrg")?.addEventListener("click", async () => {
    ensureSupabase();
    const orgName = document.getElementById("orgName").value.trim();
    if (!orgName) { alert("Escribe el nombre de la organización."); return; }

    const btn = document.getElementById("btnCreateOrg");
    setBtnLoading(btn, true, "Crear organización");
    const msgEl = document.getElementById("orgMsg");

    try {
      const { error } = await supabase.rpc("create_org_and_assign", { org_name: orgName });
      if (error) throw error;
      msgEl.innerHTML = `<div class="ok">Organización creada. Cargando…</div>`;
      await bootAuthed();
      navigate("proyectos");
    } catch (e) {
      msgEl.innerHTML = `<div class="error">${escapeHtml(e?.message || String(e))}</div>`;
    } finally {
      setBtnLoading(btn, false, "Crear organización");
    }
  });
}

// ── Dashboard ─────────────────────────────────────────────
async function renderDashboard(route) {
  const currentRoute = (route || "").replace(/^#/, "");

  // Sin org → onboarding
  if (!window.appState.profile?.organization_id) {
    renderNoOrgScreen();
    return;
  }

  const topbarHtml = renderTopBar(currentRoute);

  // ─ Home ─
  if (!currentRoute) {
    const proj = window.appState.project;
    app.innerHTML = `
      ${topbarHtml}
      <div class="container" style="padding-top:24px;">
        <div class="card" style="margin-bottom:18px;">
          <h2>Bienvenido</h2>
          <p><b>Organización:</b> ${escapeHtml(window.appState.organization?.name || "")}</p>
          ${proj
            ? `<p><b>Proyecto activo:</b> ${escapeHtml(proj.name)}</p>
               <p class="muted">Accede a <b>Presupuesto</b>, <b>Gastos</b> o <b>Ejecución</b> desde el menú de arriba.</p>`
            : `<p class="muted">No tienes proyecto activo. Ve a <b>Proyectos</b> para crear o seleccionar uno.</p>`
          }
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">
          <button class="home-card" data-nav="proyectos">
            <div class="home-card-icon">📁</div>
            <div class="home-card-title">Proyectos</div>
            <div class="home-card-desc">Crea y gestiona proyectos</div>
          </button>
          <button class="home-card" data-nav="presupuesto">
            <div class="home-card-icon">📊</div>
            <div class="home-card-title">Presupuesto</div>
            <div class="home-card-desc">Desglose y partidas</div>
          </button>
          <button class="home-card" data-nav="gastos">
            <div class="home-card-icon">💸</div>
            <div class="home-card-title">Gastos</div>
            <div class="home-card-desc">Registro de gastos reales</div>
          </button>
          <button class="home-card" data-nav="ejecucion">
            <div class="home-card-icon">🎯</div>
            <div class="home-card-title">Ejecución</div>
            <div class="home-card-desc">Semáforos vs presupuesto</div>
          </button>
        </div>
      </div>`;
    bindTopBarEvents("");
    document.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => navigate(btn.dataset.nav));
    });
    return;
  }

  // ─ Presupuesto ─
  if (currentRoute === "presupuesto") {
    let mod;
    try { mod = await import("./modules/presupuesto.js"); } catch (e) {
      _renderModuleError(topbarHtml, "presupuesto.js", e);
      return;
    }
    if (!window.appState.project?.id) {
      app.innerHTML = `${topbarHtml}<div class="container" style="padding-top:24px;"><div class="card">
        <h2>Sin proyecto activo</h2>
        <p class="muted">Selecciona un proyecto primero.</p>
        <button class="btn btn-primary" onclick="window.navigateTo('proyectos')">Ir a Proyectos</button>
      </div></div>`;
      bindTopBarEvents("presupuesto");
      return;
    }
    const content = mod.renderPresupuestoView();
    app.innerHTML = `${topbarHtml}<div class="container" style="padding-top:18px;"></div>${content}`;
    bindTopBarEvents("presupuesto");
    try { await mod.bindPresupuestoEvents(); } catch (e) {
      console.error("[presupuesto bind]", e);
      app.innerHTML += `<div class="container"><div class="error" style="margin-top:10px;">${escapeHtml(e?.message || String(e))}</div></div>`;
    }
    return;
  }

  // ─ Proyectos ─
  if (currentRoute === "proyectos") {
    let mod;
    try { mod = await import("./modules/proyectos.js"); } catch (e) {
      _renderModuleError(topbarHtml, "proyectos.js", e);
      return;
    }
    const content = mod.renderProyectosView();
    app.innerHTML = `${topbarHtml}${content}`;
    bindTopBarEvents("proyectos");
    try { await mod.bindProyectosEvents(); } catch (e) {
      console.error("[proyectos bind]", e);
    }
    return;
  }

  // ─ Gastos ─
  if (currentRoute === "gastos") {
    let mod;
    try { mod = await import("./modules/gastos.js"); } catch (e) {
      _renderModuleError(topbarHtml, "gastos.js", e);
      return;
    }
    const content = mod.renderGastosView();
    app.innerHTML = `${topbarHtml}${content}`;
    bindTopBarEvents("gastos");
    try { await mod.bindGastosEvents(); } catch (e) {
      console.error("[gastos bind]", e);
    }
    return;
  }

  // ─ Ejecución ─
  if (currentRoute === "ejecucion") {
    let mod;
    try { mod = await import("./modules/ejecucion.js"); } catch (e) {
      _renderModuleError(topbarHtml, "ejecucion.js", e);
      return;
    }
    const content = mod.renderEjecucionView();
    app.innerHTML = `${topbarHtml}${content}`;
    bindTopBarEvents("ejecucion");
    try { await mod.bindEjecucionEvents(); } catch (e) {
      console.error("[ejecucion bind]", e);
    }
    return;
  }

  // ─ Ruta no válida ─
  app.innerHTML = `
    ${topbarHtml}
    <div class="container" style="padding-top:24px;">
      <div class="card">
        <h2>Ruta no encontrada</h2>
        <p class="muted">La sección <b>${escapeHtml(currentRoute)}</b> no existe.</p>
        <button class="btn btn-primary" onclick="window.navigateTo('')">Volver al inicio</button>
      </div>
    </div>`;
  bindTopBarEvents(currentRoute);
}

function _renderModuleError(topbarHtml, name, e) {
  app.innerHTML = `${topbarHtml}
    <div class="container" style="padding-top:24px;">
      <div class="card">
        <h2>Error al cargar módulo</h2>
        <p class="error">No se pudo cargar <code>${name}</code>.</p>
        <p class="muted">${escapeHtml(e?.message || String(e))}</p>
      </div>
    </div>`;
}

// ── Router ────────────────────────────────────────────────
let routerStarted = false;
function startRouterOnce() {
  if (routerStarted) return;
  routerStarted = true;
  initRouter((hash) => renderDashboard(hash));
}

// ── Boot ──────────────────────────────────────────────────
async function bootAuthed() {
  // ✅ FIX CRÍTICO: si ya hay un boot en vuelo, ENCOLAR (no ignorar)
  if (_bootInFlight) {
    _bootQueued = true;
    console.log("[boot] ya en vuelo, encolando llamada");
    return;
  }
  _bootInFlight = true;

  try {
    ensureSupabase();

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session || null;
    const user    = session?.user || null;

    window.appState.user         = user;
    window.appState.profile      = null;
    window.appState.organization = null;

    if (!user) {
      renderLogin();
      return;
    }

    const { profile, organization } = await loadProfileAndOrg(user.id);
    window.appState.profile      = profile;
    window.appState.organization = organization;

    if (!profile) {
      app.innerHTML = `
        <div class="container" style="padding-top:40px;">
          <div class="card" style="max-width:520px;margin:0 auto;">
            <h2>Perfil no encontrado</h2>
            <p class="error">Tu usuario existe en Auth pero no en la tabla <b>profiles</b>.</p>
            <p class="muted">Ejecuta el trigger <code>handle_new_user</code> y vuelve a intentar.</p>
            <button class="btn btn-primary" id="btnLogout2">Cerrar sesión</button>
          </div>
        </div>`;
      document.getElementById("btnLogout2")?.addEventListener("click", async () => {
        try { await supabase.auth.signOut(); } catch {}
        renderLogin("Sesión cerrada.");
      });
      return;
    }

    // Cargar proyecto activo desde localStorage
    if (!window.appState.project) {
      const proj = await tryLoadActiveProject();
      window.appState.project = proj;
    }

    startRouterOnce();
    if (!window.location.hash) navigate("");

  } finally {
    _bootInFlight = false;

    // ✅ Si hubo llamada concurrente, ejecutar una vez más
    if (_bootQueued) {
      _bootQueued = false;
      Promise.resolve().then(() => bootAuthed());
    }
  }
}

async function boot() {
  ensureSupabase();

  // ✅ Boot inicial (sin esperar al listener de auth)
  await bootAuthed();

  // ✅ Suscripción única — manejamos cada evento por separado
  if (_authUnsubscribe) {
    try { _authUnsubscribe(); } catch {}
    _authUnsubscribe = null;
  }

  const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
    console.log("[auth change]", event);

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      await bootAuthed();

    } else if (event === "SIGNED_OUT") {
      window.appState.user         = null;
      window.appState.profile      = null;
      window.appState.organization = null;
      window.appState.project      = null;
      localStorage.removeItem("ACTIVE_PROJECT_ID");
      renderLogin("Sesión cerrada.");

    } else if (event === "INITIAL_SESSION") {
      if (session && !window.appState.user) {
        await bootAuthed();
      }
    }
  });

  _authUnsubscribe = () => {
    try { sub.subscription.unsubscribe(); } catch {}
  };
}

boot();