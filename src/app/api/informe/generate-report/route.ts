/**
 * POST /api/informe/generate-report
 *
 * Al guardar un droneo en Arena, este endpoint:
 *  1. Genera el PDF del informe de cubicación (pdf-lib)
 *  2. Sube el PDF a la carpeta OneDrive/SharePoint configurada (Graph API)
 *  3. Envía email a gerencia con el PDF adjunto (Graph API — Mail.Send)
 *
 * Requiere en .env:
 *   REPORT_EMAIL_TO      = "gerencia@migrin.cl,otro@migrin.cl"
 *   REPORT_ONEDRIVE_PATH = "Informes Cubicacion"   (carpeta raíz de tu OneDrive)
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions }      from "@/lib/authOptions";
import { createClient }     from "@supabase/supabase-js";
import { generarInformePDF, type InformeData } from "@/lib/informe-pdf";
import { generarImagenEmail } from "@/lib/email-image";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Lee configuración desde Supabase (tabla configuracion), con fallback a env vars
async function getConfig(clave: string, fallback = ""): Promise<string> {
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("configuracion")
      .select("valor")
      .eq("clave", clave)
      .maybeSingle();
    return data?.valor ?? fallback;
  } catch {
    return fallback;
  }
}

export const dynamic = "force-dynamic";

// ── helpers Graph API ────────────────────────────────────────────────────────

async function uploadToOneDrive(
  accessToken: string,
  fileName: string,
  pdfBytes: Uint8Array,
): Promise<string | null> {
  const folder = (await getConfig("report_onedrive_path", process.env.REPORT_ONEDRIVE_PATH ?? "Informes Cubicacion")).trim();
  const path   = encodeURIComponent(`${folder}/${fileName}`);
  const url    = `https://graph.microsoft.com/v1.0/me/drive/root:/${path}:/content`;

  console.log("[generate-report] Uploading to OneDrive path:", folder, "file:", fileName);
  const res = await fetch(url, {
    method:  "PUT",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[generate-report] OneDrive upload failed:", res.status, err);
    return null;
  }

  const json = await res.json() as { webUrl?: string };
  console.log("[generate-report] OneDrive upload OK:", json.webUrl);
  return json.webUrl ?? null;
}

async function sendEmailWithPDF(
  accessToken: string,
  fileName: string,
  pdfBytes: Uint8Array,
  data: InformeData,
  driveUrl: string | null,
): Promise<boolean> {
  // Leer destinatarios desde report_recipients (JSON), fallback a report_email_to CSV
  const recipientsRaw = await getConfig("report_recipients", "");
  let activeList: { email: string; nombre: string; activo: boolean }[] = [];
  if (recipientsRaw) {
    try { activeList = JSON.parse(recipientsRaw); } catch { /* */ }
  }
  if (activeList.length === 0) {
    const toRaw = await getConfig("report_email_to", process.env.REPORT_EMAIL_TO ?? "");
    activeList = toRaw.split(",").map(e => e.trim()).filter(Boolean)
      .map(email => ({ email, nombre: "", activo: true }));
  }
  const recipients = activeList
    .filter(r => r.activo && r.email)
    .map(r => ({ emailAddress: { address: r.email } }));

  if (recipients.length === 0) {
    console.warn("[generate-report] Sin destinatarios activos — email omitido");
    return false;
  }

  const fechaFmt = data.fecha.split("-").reverse().join("/");
  const subject  = `Informe Cubicación Arena — ${fechaFmt} ${data.hora}`;

  // Generar imagen PNG del informe
  const cardBuffer = await generarImagenEmail({
    fecha:               data.fecha,
    hora:                data.hora,
    productividad_drone: data.productividad_drone,
    produccion_drone:    data.produccion_drone,
    inventario_ton:      data.inventario_ton,
    despachos_ton:       data.despachos_ton,
    cantidad_despachos:  data.cantidad_despachos,
    horas_reales:        data.horas_reales,
    detencion:           data.detencion,
    usuario_email:       data.usuario_email,
    isReenvio:           false,
  });
  const cardBase64 = cardBuffer.toString("base64");
  const pdfBase64  = Buffer.from(pdfBytes).toString("base64");

  const driveLink = driveUrl
    ? `<p style="text-align:center;margin-top:12px;font-size:12px;color:#6b7280;font-family:Arial,sans-serif">PDF archivado en OneDrive: <a href="${driveUrl}" style="color:#6BCF7F">${fileName}</a></p>`
    : "";

  const bodyHtml =
    `<div style="background:#f8fafc;padding:24px 0;text-align:center">` +
    `<img src="cid:informe-card@migrin" alt="Informe Cubicacion Arena" ` +
    `style="display:block;margin:0 auto;max-width:560px;width:100%;border:0" />` +
    driveLink +
    `</div>`;

  const body = {
    message: {
      subject,
      body:         { contentType: "HTML", content: bodyHtml },
      toRecipients: recipients,
      attachments:  [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: fileName, contentType: "application/pdf", contentBytes: pdfBase64,
        },
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name:          "informe-card.png",
          contentType:   "image/png",
          contentBytes:  cardBase64,
          contentId:     "informe-card@migrin",
          isInline:      true,
        },
      ],
    },
    saveToSentItems: false,
  };

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[generate-report] sendMail failed:", res.status, err);
    return false;
  }

  return true;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session?.user as { accessToken?: string })?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "Sin token de acceso. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const data = await req.json() as InformeData;
    if (session?.user?.email) {
      data.usuario_email = session.user.email;
    }

    // Traer registros del año actual (para gráficos) y últimos 10 (para tabla)
    try {
      const sb = getSupabase();
      const year = new Date().getFullYear();
      const yearStart = `${year}-01-01`;

      const SELECT_FIELDS = "fecha, hora, produccion_drone, productividad_drone, productividad_pesometro, diferencia_pesometro, horas_reales, detencion, despachos_ton, cantidad_despachos, inventario_ton";

      // Año completo para gráficos
      const { data: yearRows } = await sb
        .from("registros_arena")
        .select(SELECT_FIELDS)
        .gte("fecha", yearStart)
        .order("fecha_hora", { ascending: true });

      // Últimos 10 para tabla de cubicación
      const { data: last10 } = await sb
        .from("registros_arena")
        .select(SELECT_FIELDS)
        .order("fecha_hora", { ascending: false })
        .limit(10);

      if (last10) {
        data.historial = (last10 as InformeData["historial"])?.reverse() ?? [];
      }

      if (yearRows && yearRows.length > 0) {
        data.historialChart = yearRows as InformeData["historialChart"];

        // Agrupar por semana ISO para semanalStats (año completo)
        const semMap = new Map<string, { prodDrone: number; prodPeso: number; hrsProd: number; detencion: number; despachos: number; viajes: number }>();
        for (const r of yearRows) {
          const d = new Date(r.fecha + "T12:00:00");
          // Semana ISO: lunes como primer día
          const startOfYear = new Date(year, 0, 1);
          const dayOfYear = Math.floor((d.getTime() - startOfYear.getTime()) / 86400000);
          const weekNum = Math.floor(dayOfYear / 7) + 1;
          const key = `${year}-S${String(weekNum).padStart(2, "0")}`;
          const cur = semMap.get(key) ?? { prodDrone: 0, prodPeso: 0, hrsProd: 0, detencion: 0, despachos: 0, viajes: 0 };
          cur.prodDrone  += r.produccion_drone ?? 0;
          // prodPeso = productividad (t/h) × horas reales — evita valores extremos de diferencia_pesometro
          cur.prodPeso   += (r.productividad_pesometro ?? 0) * (r.horas_reales ?? 0);
          cur.hrsProd    += r.horas_reales      ?? 0;
          cur.detencion  += r.detencion         ?? 0;
          cur.despachos  += r.despachos_ton     ?? 0;
          cur.viajes     += r.cantidad_despachos ?? 0;
          semMap.set(key, cur);
        }

        data.semanalStats = Array.from(semMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([semana, s]) => ({
            semana,
            prodDrone: s.prodDrone,
            prodPeso:  s.prodPeso,
            hrsProd:   s.hrsProd,
            detencion: s.detencion,
            despachos: s.despachos,
            viajes:    s.viajes,
          }));
      }
    } catch (e) {
      console.warn("[generate-report] historial/semanal fetch failed:", e);
    }

    // 1. Generar PDF
    const pdfBytes = await generarInformePDF(data);
    const fecha    = data.fecha.replace(/-/g, "");
    const hora     = data.hora.replace(":", "");
    const fileName = `informe-cubicacion-${fecha}-${hora}.pdf`;

    // 2. Subir a OneDrive
    const driveUrl = await uploadToOneDrive(accessToken, fileName, pdfBytes);

    // 3. Enviar email
    const emailOk  = await sendEmailWithPDF(accessToken, fileName, pdfBytes, data, driveUrl);

    return NextResponse.json({
      ok:       true,
      driveUrl: driveUrl ?? null,
      emailOk,
    });
  } catch (e: unknown) {
    console.error("[generate-report] unhandled error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
