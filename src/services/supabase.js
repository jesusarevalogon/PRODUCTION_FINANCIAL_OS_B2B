// src/services/supabase.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/**
 * ⚠️ CONFIGURACIÓN FIJA PARA FRONTEND ESTÁTICO (Vercel / GitHub Pages)
 * No dependemos de window.__SUPABASE_CONFIG__
 */

// 🔑 TU PROJECT ID
const SUPABASE_URL = "https://fiurztzszhtpvhwdpggk.supabase.co";

// 🔑 PEGA AQUÍ TU anon public key
// (Supabase Dashboard → Settings → API → anon public)
const SUPABASE_ANON_KEY = "sb_publishable_bjUYAYhBy9DY4wjmLmSokQ_12cqoFz6";

/**
 * Guardas para detectar errores de deploy inmediatamente
 */
if (!SUPABASE_URL || !SUPABASE_URL.startsWith("https://")) {
  throw new Error("[supabase] SUPABASE_URL inválida");
}

if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.length < 20) {
  throw new Error("[supabase] SUPABASE_ANON_KEY inválida");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});