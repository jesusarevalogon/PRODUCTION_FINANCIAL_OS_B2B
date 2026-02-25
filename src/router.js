// src/router.js
export function initRouter(onRoute) {
  function handle() {
    const hash = window.location.hash || "";
    onRoute(hash);
  }
  window.addEventListener("hashchange", handle);
  handle();
}

export function navigate(route) {
  // route: "" | "proyectos" | "presupuesto" | "gastos" | "ejecucion" | "ruta" | "documentacion" | "entrega"
  window.location.hash = route ? `#${route}` : "";
}
