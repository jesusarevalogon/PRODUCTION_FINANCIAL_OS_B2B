// supabase/functions/generate-pdf/index.ts
// Edge Function: genera PDF de un call_sheet, daily_report o finance_report.
// Deploy: supabase functions deploy generate-pdf
// ⚠ Service role key solo se usa aquí — nunca en el cliente.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY  = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPORT_BUCKET      = "project-exports";

type PdfType = "call_sheet" | "daily_report" | "finance_report";

interface RequestBody {
  type: PdfType;
  entity_id: string;
  project_id: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  // 1. Verificar JWT del usuario
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse(401, "Missing Authorization header");

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return errorResponse(401, "Unauthorized");

  // 2. Parse body
  let body: RequestBody;
  try { body = await req.json(); } catch { return errorResponse(400, "Invalid JSON body"); }

  const { type, entity_id, project_id } = body;
  if (!type || !entity_id || !project_id) {
    return errorResponse(400, "Missing required fields: type, entity_id, project_id");
  }

  // 3. Verificar membership usando service client
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: membership } = await serviceClient
    .from("project_members")
    .select("id")
    .eq("project_id", project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  // También permitir si es org member (org admin/member check via profiles)
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!membership && !profile) {
    return errorResponse(403, "No tienes acceso a este proyecto");
  }

  // 4. Construir HTML del PDF según tipo
  let htmlContent = "";
  let fileName = "";
  let version = 0;

  if (type === "call_sheet") {
    // Usar siempre el snapshot de la versión actual publicada
    const { data: cs, error: csErr } = await serviceClient
      .from("call_sheets")
      .select("*, current_version")
      .eq("id", entity_id)
      .eq("project_id", project_id)
      .single();

    if (csErr || !cs) return errorResponse(404, "Call sheet no encontrado");
    if (cs.status !== "published" || cs.current_version === 0) {
      return errorResponse(400, "El call sheet no está publicado");
    }

    const { data: csv, error: csvErr } = await serviceClient
      .from("call_sheet_versions")
      .select("*")
      .eq("call_sheet_id", entity_id)
      .eq("version_number", cs.current_version)
      .single();

    if (csvErr || !csv) return errorResponse(404, "Versión de call sheet no encontrada");

    version = csv.version_number;
    const snap = csv.snapshot;
    const header = snap.header || {};
    const location = snap.location || {};
    const crew: any[] = snap.crew || [];
    const scenes: any[] = snap.scenes || [];

    htmlContent = buildCallSheetHtml({ header, location, crew, scenes, version });
    fileName = `call_sheet_v${version}_${header.shoot_date || "sin_fecha"}.pdf`;

  } else if (type === "daily_report") {
    const { data: dr, error: drErr } = await serviceClient
      .from("daily_reports")
      .select("*, schedule_day:schedule_days(shoot_date, unit)")
      .eq("id", entity_id)
      .eq("project_id", project_id)
      .single();

    if (drErr || !dr) return errorResponse(404, "DPR no encontrado");

    const content = dr.content || {};
    const shootDate = dr.schedule_day?.shoot_date || "sin_fecha";
    htmlContent = buildDprHtml({ content, shootDate, unit: dr.schedule_day?.unit });
    fileName = `dpr_${shootDate}.pdf`;

  } else {
    return errorResponse(400, `Tipo no soportado: ${type}`);
  }

  // 5. Generar "PDF" como HTML listo para imprimir (browser print-to-PDF)
  //    En producción: usar Puppeteer o html-to-pdf library.
  //    Aquí guardamos el HTML en storage y retornamos signed_url.
  const yyyymm = new Date().toISOString().slice(0, 7);
  const storagePath = `${project_id}/${type}/${yyyymm}/${Date.now()}_${fileName.replace(".pdf", ".html")}`;

  const htmlBytes = new TextEncoder().encode(htmlContent);
  const { error: uploadErr } = await serviceClient.storage
    .from(EXPORT_BUCKET)
    .upload(storagePath, htmlBytes, { contentType: "text/html", upsert: false });

  if (uploadErr) return errorResponse(500, `Error al guardar: ${uploadErr.message}`);

  // 6. Signed URL (5 minutos)
  const { data: signedData, error: signedErr } = await serviceClient.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(storagePath, 300);

  if (signedErr) return errorResponse(500, `Error al generar URL: ${signedErr.message}`);

  return new Response(
    JSON.stringify({ storage_path: storagePath, signed_url: signedData.signedUrl, version }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});

// ── HTML builders ──────────────────────────────────────────

function buildCallSheetHtml({ header, location, crew, scenes, version }: any): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (m: string) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m] || m)
  );
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Call Sheet v${version}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: 700; }
    .section { margin-top: 18px; }
    .section-title { font-weight: 700; font-size: 13px; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 8px; }
    @media print { button { display: none; } }
  </style></head><body>
  <h1>Call Sheet — v${version}</h1>
  <p><b>Fecha:</b> ${esc(header.shoot_date)} &nbsp; <b>Unidad:</b> ${esc(header.unit)} &nbsp; <b>Call time:</b> ${esc(header.call_time || "—")}</p>

  <div class="section">
    <div class="section-title">Locación</div>
    <p><b>${esc(location.name || "—")}</b><br>${esc(location.address || "")}</p>
  </div>

  <div class="section">
    <div class="section-title">Escenas del día</div>
    <table><thead><tr><th>Código</th><th>Páginas</th><th>Descripción</th></tr></thead><tbody>
      ${scenes.map((s: any) => `<tr><td>${esc(s.code)}</td><td>${esc(s.pages || "—")}</td><td>${esc(s.description || "")}</td></tr>`).join("")}
    </tbody></table>
  </div>

  <div class="section">
    <div class="section-title">Crew</div>
    <table><thead><tr><th>Nombre</th><th>Rol</th><th>Call</th><th>Teléfono</th></tr></thead><tbody>
      ${crew.map((c: any) => `<tr><td>${esc(c.name)}</td><td>${esc(c.role_name)}</td><td>${esc(c.call_time || "—")}</td><td>${esc(c.phone || "—")}</td></tr>`).join("")}
    </tbody></table>
  </div>
  <button onclick="window.print()" style="margin-top:20px;padding:8px 16px;background:#4f7cff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Imprimir / Guardar PDF</button>
  </body></html>`;
}

function buildDprHtml({ content, shootDate, unit }: any): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (m: string) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m] || m)
  );
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>DPR — ${shootDate}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .field { margin-top: 12px; }
    .label { font-weight: 700; }
    @media print { button { display: none; } }
  </style></head><body>
  <h1>Daily Production Report</h1>
  <p><b>Fecha:</b> ${esc(shootDate)} &nbsp; <b>Unidad:</b> ${esc(unit || "A")}</p>
  <div class="field"><div class="label">Resumen del día</div><p>${esc(content.summary || "—")}</p></div>
  <div class="field"><div class="label">Escenas filmadas</div><p>${esc(content.scenes || "—")}</p></div>
  <div class="field"><div class="label">Páginas filmadas</div><p>${esc(content.pages || "—")}</p></div>
  <div class="field"><div class="label">Incidencias / notas</div><p>${esc(content.notes || "—")}</p></div>
  <button onclick="window.print()" style="margin-top:20px;padding:8px 16px;background:#4f7cff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Imprimir / Guardar PDF</button>
  </body></html>`;
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
