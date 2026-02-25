// src/utils/format.js
// Helpers de formato: moneda, fechas, números

export function noop() {}

/**
 * Formatea un número como moneda.
 * @param {number} amount
 * @param {string} currency  e.g. "MXN" | "USD"
 */
export function formatCurrency(amount, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount ?? 0);
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD) como texto legible en español.
 * @param {string} iso
 */
export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Hoy en formato YYYY-MM-DD.
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Escapa HTML para insertar en el DOM de forma segura.
 */
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[m]));
}
