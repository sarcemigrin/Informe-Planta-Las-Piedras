/**
 * POST /api/informe/reenviar
 * Regenera el PDF de un registro existente y lo reenvía por correo.
 * Body: { registroId: string }
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions }      from "@/lib/authOptions";
import { createClient }     from "@supabase/supabase-js";
import { generarInformePDF, type InformeData, type RegistroResumen, type SemanaStat } from "@/lib/informe-pdf";

export const dynamic = "force-dynamic";

const SELECT_FIELDS = "fecha,hora,produccion_drone,productividad_drone,productividad_pesometro,diferencia_pesometro,horas_reales,detencion,despachos_ton,cantidad_despachos,inventario_ton";

function getClient(useService = false) {
  const key = useService
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

async function getConfig(clave: string, fallback = ""): Promise<string> {
  try {
    const { data } = await getClient()
      .from("configuracion").select("valor").eq("clave", clave).maybeSingle();
    return data?.valor ?? fallback;
  } catch { return fallback; }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session?.user as { accessToken?: string })?.accessToken;
    if (!accessToken) {
      return NextResponse.json({ error: "Sin token de acceso" }, { status: 401 });
    }

    const { registroId } = await req.json() as { registroId: string };
    if (!registroId) {
      return NextResponse.json({ error: "registroId requerido" }, { status: 400 });
    }

    const sb = getClient();

    // 1. Obtener el registro seleccionado
    const { data: reg, error: regErr } = await sb
      .from("registros_arena")
      .select("*")
      .eq("id", registroId)
      .single();

    if (regErr || !reg) {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }

    // 2. Historial últimos 10 + año completo para gráfico
    const year = new Date(reg.fecha).getFullYear();
    const yearStart = `${year}-01-01`;

    const [{ data: last10 }, { data: yearRows }] = await Promise.all([
      sb.from("registros_arena").select(SELECT_FIELDS)
        .order("fecha_hora", { ascending: false }).limit(10),
      sb.from("registros_arena").select(SELECT_FIELDS)
        .gte("fecha", yearStart).order("fecha_hora", { ascending: true }),
    ]);

    // 3. Calcular semanalStats
    const semMap = new Map<string, { prodDrone: number; prodPeso: number; hrsProd: number; detencion: number; despachos: number; viajes: number }>();
    for (const r of yearRows ?? []) {
      const d = new Date(r.fecha + "T12:00:00");
      const startOfYear = new Date(year, 0, 1);
      const dayOfYear = Math.floor((d.getTime() - startOfYear.getTime()) / 86400000);
      const weekNum = Math.floor(dayOfYear / 7) + 1;
      const key = `${year}-S${String(weekNum).padStart(2, "0")}`;
      const cur = semMap.get(key) ?? { prodDrone: 0, prodPeso: 0, hrsProd: 0, detencion: 0, despachos: 0, viajes: 0 };
      cur.prodDrone  += r.produccion_drone   ?? 0;
      cur.prodPeso   += (r.productividad_pesometro ?? 0) * (r.horas_reales ?? 0);
      cur.hrsProd    += r.horas_reales       ?? 0;
      cur.detencion  += r.detencion          ?? 0;
      cur.despachos  += r.despachos_ton      ?? 0;
      cur.viajes     += r.cantidad_despachos ?? 0;
      semMap.set(key, cur);
    }
    const semanalStats: SemanaStat[] = Array.from(semMap.entries())
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([semana, s]) => ({ semana, ...s }));

    // 4. Construir InformeData
    const data: InformeData = {
      fecha:                   reg.fecha,
      hora:                    reg.hora,
      produccion_drone:        reg.produccion_drone        ?? 0,
      productividad_drone:     reg.productividad_drone     ?? 0,
      productividad_pesometro: reg.productividad_pesometro ?? 0,
      diferencia_pesometro:    reg.diferencia_pesometro    ?? 0,
      horas_reales:            reg.horas_reales            ?? 0,
      detencion:               reg.detencion               ?? 0,
      despachos_ton:           reg.despachos_ton           ?? 0,
      cantidad_despachos:      reg.cantidad_despachos      ?? 0,
      inventario_ton:          reg.inventario_ton          ?? 0,
      usuario_email:           session.user?.email ?? "sistema",
      historial:               ((last10 ?? []) as RegistroResumen[]).reverse(),
      historialChart:          (yearRows ?? []) as RegistroResumen[],
      semanalStats,
    };

    // 5. Generar PDF
    const pdfBytes = await generarInformePDF(data);
    const fechaStr = reg.fecha.replace(/-/g, "");
    const horaStr  = (reg.hora ?? "").replace(":", "").slice(0, 4);
    const fileName = `informe-cubicacion-${fechaStr}-${horaStr}.pdf`;
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // 6. Subir a OneDrive
    const folder = (await getConfig("report_onedrive_path", "Informes Cubicacion")).trim();
    const uploadUrl = "https://graph.microsoft.com/v1.0/me/drive/root:/" + encodeURIComponent(folder + "/" + fileName) + ":/content";
    let driveUrl: string | null = null;
    const upRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/pdf" },
      body: pdfBytes,
    });
    if (upRes.ok) { const j = await upRes.json() as { webUrl?: string }; driveUrl = j.webUrl ?? null; }

    // 7. Leer destinatarios activos desde report_recipients
    const recipientsRaw = await getConfig("report_recipients", "");
    let activeRecipients: { email: string; nombre: string; activo: boolean }[] = [];
    if (recipientsRaw) {
      try { activeRecipients = JSON.parse(recipientsRaw); } catch { /* */ }
    }
    if (activeRecipients.length === 0) {
      const toRaw = await getConfig("report_email_to", "");
      activeRecipients = toRaw.split(",").map(e => e.trim()).filter(Boolean)
        .map(email => ({ email, nombre: "", activo: true }));
    }
    const recipients = activeRecipients
      .filter(r => r.activo && r.email)
      .map(r => ({ emailAddress: { address: r.email } }));

    if (recipients.length === 0) {
      return NextResponse.json({ ok: true, driveUrl, emailOk: false, error: "Sin destinatarios activos" });
    }

    // 8. Enviar email
    const fechaFmt = reg.fecha.split("-").reverse().join("/");
    const n = (v: number | null, dec = 1) =>
      v != null && isFinite(v) ? v.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
    const detPct = (reg.horas_reales + reg.detencion) > 0
      ? (reg.detencion / (reg.horas_reales + reg.detencion) * 100).toFixed(0) + "%" : "—";
    const kpiColor = (v: number | null) => v != null && v >= 32 ? "#16a34a" : "#dc2626";
    const invColor = (v: number | null) => v != null && v >= 7500 ? "#16a34a" : v != null && v >= 6500 ? "#d97706" : "#dc2626";

    function row(label: string, value: string, color = "#374151") {
      return '<tr style="border-bottom:1px solid #e5e7eb">'
        + '<td style="padding:8px 0;color:#6b7280;font-size:13px">' + label + '</td>'
        + '<td style="padding:8px 0;font-weight:600;color:' + color + ';text-align:right;font-size:13px">' + value + '</td>'
        + '</tr>';
    }

    const htmlContent = '<div style="font-family:Arial,sans-serif;color:#374151;max-width:560px">'
      + '<div style="background:#374151;padding:20px 24px;border-left:5px solid #6BCF7F">'
      + '<h2 style="color:#fff;margin:0;font-size:18px">Informe de Cubicacion Arena</h2>'
      + '<p style="color:#94a3b8;margin:6px 0 0;font-size:12px">Planta Las Piedras &nbsp;&middot;&nbsp; ' + fechaFmt + ' ' + reg.hora + ' &nbsp;&middot;&nbsp; REENVIO</p>'
      + '</div>'
      + '<div style="padding:20px 24px;background:#f6f8fb">'
      + '<table style="width:100%;border-collapse:collapse">'
      + row("Productividad Drone",    n(reg.productividad_drone) + " t/h",    kpiColor(reg.productividad_drone))
      + row("Produccion Drone",       Math.round(reg.produccion_drone ?? 0).toLocaleString("es-CL") + " ton")
      + row("Inventario",             Math.round(reg.inventario_ton ?? 0).toLocaleString("es-CL") + " ton", invColor(reg.inventario_ton))
      + row("Despachos",              Math.round(reg.despachos_ton ?? 0).toLocaleString("es-CL") + " ton - " + (reg.cantidad_despachos ?? 0) + " viajes")
      + row("Horas produccion",       n(reg.horas_reales) + " hrs")
      + row("Detencion",              n(reg.detencion) + " hrs (" + detPct + ")", reg.detencion > 0 ? "#dc2626" : "#374151")
      + "</table>"
      + (driveUrl ? "<p style='margin-top:16px;font-size:12px;color:#6b7280'>PDF archivado en OneDrive: <a href='" + driveUrl + "' style='color:#6BCF7F'>" + fileName + "</a></p>" : "")
      + "<p style='margin-top:8px;font-size:11px;color:#9ca3af'>Reenviado por: " + (session.user?.email ?? "sistema") + " - generado automaticamente.</p>"
      + "</div></div>";

    const mailBody = {
      message: {
        subject: "Informe Cubicacion Arena [REENVIO] - " + fechaFmt + " " + reg.hora,
        body: { contentType: "HTML", content: htmlContent },
        toRecipients: recipients,
        attachments: [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: fileName, contentType: "application/pdf", contentBytes: pdfBase64,
        }],
      },
      saveToSentItems: false,
    };

    const mailRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(mailBody),
    });

    return NextResponse.json({ ok: true, driveUrl, emailOk: mailRes.ok });

  } catch (e: unknown) {
    console.error("[reenviar] error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
