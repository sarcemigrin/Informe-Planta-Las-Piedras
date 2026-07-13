/**
 * POST /api/informe/notify-centro
 *
 * Envía email de notificación al guardar un registro de Zona Centro.
 * Sin PDF adjunto — cuerpo HTML con KPIs + botón a la app.
 *
 * Body: { planta: "turco"|"peral", fecha, hora, kpis: Record<string,number|null> }
 * Destinatarios configurados en tabla `configuracion`:
 *   clave "turco_recipients"  → JSON igual que report_recipients
 *   clave "peral_recipients"  → JSON igual que report_recipients
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken }         from "next-auth/jwt";
import { authOptions }      from "@/lib/authOptions";
import { requireJson }      from "@/lib/apiGuard";
import { createClient }     from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function getConfig(clave: string, fallback = ""): Promise<string> {
  try {
    const { data } = await getSupabase()
      .from("configuracion").select("valor").eq("clave", clave).maybeSingle();
    return data?.valor ?? fallback;
  } catch { return fallback; }
}

async function getRecipients(planta: "turco" | "peral") {
  const key = planta === "turco" ? "turco_recipients" : "peral_recipients";
  const raw = await getConfig(key, "");
  if (!raw) return [];
  try {
    const list: { email: string; nombre: string; activo: boolean }[] = JSON.parse(raw);
    return list
      .filter(r => r.activo && r.email)
      .map(r => ({ emailAddress: { address: r.email } }));
  } catch { return []; }
}

function fmtN(v: number | null | undefined, dec = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function buildTurcoHtml(fecha: string, hora: string, kpis: Record<string, number | null>, appUrl: string): string {
  const rows = [
    ["TLH",            kpis.tlh_ton,            "ton"],
    ["Arena Mina",     kpis.arena_mina_ton,      "ton"],
    ["Estéril",        kpis.esteril_ton,         "ton"],
    ["Grancilla",      kpis.grancilla_ton,       "ton"],
    ["Fierrillo A",    kpis.fierrillo_a_ton,     "ton"],
    ["Fierrillo B",    kpis.fierrillo_b_ton,     "ton"],
    ["Fierrillo Total",kpis.fierrillo_total_ton, "ton"],
  ] as [string, number | null, string][];

  const rowsHtml = rows.map(([label, val, unit], i) =>
    `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"}">
      <td style="padding:8px 16px;color:#6b7280;font-size:13px">${label}</td>
      <td style="padding:8px 16px;font-weight:${label==="Fierrillo Total"||label==="TLH"?"700":"500"};color:${label==="TLH"?"#b45309":label==="Fierrillo Total"?"#15803d":"#111827"};text-align:right;font-size:14px">${fmtN(val)} ${unit}</td>
    </tr>`
  ).join("");

  return buildEmailShell("Turco", fecha, hora, rowsHtml, "#f59e0b", "#78350f", appUrl);
}

function buildPeralHtml(fecha: string, hora: string, kpis: Record<string, number | null>, appUrl: string): string {
  const rows = [
    ["Stock Arena Húmeda", kpis.stock_arena_humeda_ton, "ton"],
    ["Arena Mina",         kpis.arena_mina_ton,         "ton"],
    ["A-22",               kpis.a22_ton,                "ton"],
    ["A-24",               kpis.a24_ton,                "ton"],
    ["A-25",               kpis.a25_ton,                "ton"],
    ["A-26",               kpis.a26_ton,                "ton"],
    ["DMH",                kpis.dmh_ton,                "ton"],
    ["Grancilla",          kpis.grancilla_ton,          "ton"],
  ] as [string, number | null, string][];

  const rowsHtml = rows.map(([label, val, unit], i) =>
    `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"}">
      <td style="padding:8px 16px;color:#6b7280;font-size:13px">${label}</td>
      <td style="padding:8px 16px;font-weight:${label==="Stock Arena Húmeda"?"700":"500"};color:${label==="Stock Arena Húmeda"?"#15803d":"#111827"};text-align:right;font-size:14px">${fmtN(val)} ${unit}</td>
    </tr>`
  ).join("");

  return buildEmailShell("Peral", fecha, hora, rowsHtml, "#6BCF7F", "#14532d", appUrl);
}

function buildEmailShell(planta: string, fecha: string, hora: string, rowsHtml: string, accentHex: string, darkHex: string, appUrl: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <!-- Header -->
    <tr><td style="background:${accentHex};padding:24px 32px">
      <p style="margin:0;font-size:11px;color:${darkHex};text-transform:uppercase;letter-spacing:1px;font-weight:700">Fotogrametría Migrin</p>
      <h1 style="margin:4px 0 0;font-size:22px;color:#ffffff">Nuevo registro — Planta ${planta}</h1>
    </td></tr>
    <!-- Fecha -->
    <tr><td style="padding:16px 32px 8px;border-bottom:1px solid #f0f0f0">
      <p style="margin:0;font-size:13px;color:#6b7280">📅 <strong style="color:#374151">${fecha}</strong> a las <strong style="color:#374151">${hora?.slice(0,5) ?? ""}</strong></p>
    </td></tr>
    <!-- KPIs table -->
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr style="background:#f8fafc"><th style="padding:10px 16px;font-size:11px;color:#9ca3af;text-align:left;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Producto</th><th style="padding:10px 16px;font-size:11px;color:#9ca3af;text-align:right;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Inventario</th></tr>
        ${rowsHtml}
      </table>
    </td></tr>
    <!-- CTA -->
    <tr><td style="padding:24px 32px;text-align:center">
      <a href="${appUrl}" style="display:inline-block;background:${accentHex};color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px">Ver en la App →</a>
    </td></tr>
    <!-- Footer -->
    <tr><td style="padding:16px 32px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="margin:0;font-size:11px;color:#9ca3af">Migrin · Faena Las Piedras, Turco y Peral · Notificación automática</p>
    </td></tr>
  </table>
  </td></tr></table>
</body></html>`;
}

export async function POST(req: Request) {
  try {
    const ctErr = requireJson(req);
    if (ctErr) return ctErr;

    const session = await getServerSession(authOptions);
    const token   = await getToken({ req: req as Parameters<typeof getToken>[0]["req"] });
    const accessToken = token?.accessToken as string | undefined;

    if (!session?.user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    if (session.user.rol !== "admin") return NextResponse.json({ error: "Solo administradores." }, { status: 403 });
    if (!accessToken) return NextResponse.json({ error: "Sin token de acceso." }, { status: 401 });

    const body = await req.json() as { planta: "turco"|"peral"; fecha: string; hora: string; kpis: Record<string, number | null> };
    const { planta, fecha, hora, kpis } = body;

    if (!planta || !fecha) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });

    const recipients = await getRecipients(planta);
    if (recipients.length === 0) {
      return NextResponse.json({ ok: false, warn: `Sin destinatarios para ${planta}. Configura "${planta}_recipients" en Supabase.` });
    }

    const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://informe-planta-las-piedras.vercel.app";
    const htmlBody = planta === "turco"
      ? buildTurcoHtml(fecha, hora, kpis, appUrl)
      : buildPeralHtml(fecha, hora, kpis, appUrl);

    const subject = `Nuevo registro ${planta.charAt(0).toUpperCase()+planta.slice(1)} — ${fecha}`;

    const graphBody = {
      message: {
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: recipients,
      },
      saveToSentItems: false,
    };

    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method:  "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body:    JSON.stringify(graphBody),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[notify-centro] sendMail failed:", res.status, err);
      return NextResponse.json({ error: `Error al enviar: ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, planta, recipients: recipients.length });
  } catch (e: unknown) {
    console.error("[notify-centro] error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
