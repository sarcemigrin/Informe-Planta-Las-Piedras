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
import { getToken }         from "next-auth/jwt";
import { authOptions }      from "@/lib/authOptions";
import { requireJson }      from "@/lib/apiGuard";
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
    body: Buffer.from(pdfBytes),
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
    inventario_cuarzo:   data.inventario_cuarzo,
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
    const ctErr = requireJson(req);
    if (ctErr) return ctErr;

    const session = await getServerSession(authOptions);
    const token   = await getToken({ req: req as Parameters<typeof getToken>[0]["req"] });
    const accessToken = token?.accessToken as string | undefined;

    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (session.user.rol !== "admin") {
      return NextResponse.json({ error: "Sin permisos. Se requiere rol admin." }, { status: 403 });
    }
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

      const SELECT_FIELDS = "fecha, hora, produccion_drone, productividad_drone, productividad_pesometro, produccion_pesometro, diferencia, diferencia_pesometro, horas_reales, diferencia_horometro, detencion, despachos_ton, cantidad_despachos, inventario_ton";

      // Año completo para gráficos + últimos 10 + último cuarzo
      const [{ data: yearRows }, { data: last10 }, { data: lastCuarzo }] = await Promise.all([
        sb.from("registros_arena").select(SELECT_FIELDS)
          .gte("fecha", yearStart).order("fecha_hora", { ascending: true }),
        sb.from("registros_arena").select(SELECT_FIELDS)
          .order("fecha_hora", { ascending: false }).limit(10),
        sb.from("registros_cuarzo").select("inventario_ton")
          .order("fecha_hora", { ascending: false }).limit(1),
      ]);

      if (last10) {
        data.historial = (last10 as InformeData["historial"])?.reverse() ?? [];
      }
      if (lastCuarzo && lastCuarzo.length > 0) {
        data.inventario_cuarzo = (lastCuarzo[0] as { inventario_ton: number | null }).inventario_ton;
      }

      if (yearRows && yearRows.length > 0) {
        data.historialChart = yearRows as InformeData["historialChart"];

        // Agrupar por semana ISO — mismo algoritmo que informe/page.tsx
        // ISO week key: lunes como primer día, año ISO (puede diferir del año calendario)
        function isoWeekKey(date: Date): string {
          const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
          const dayNum = d.getUTCDay() || 7; // 1=Lun … 7=Dom
          d.setUTCDate(d.getUTCDate() + 4 - dayNum); // jueves de la semana
          const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
          return `${d.getUTCFullYear()}-S${String(weekNo).padStart(2, "0")}`;
        }

        type SemEntry = { prodDrone: number; prodPeso: number; hrsProd: number; detencion: number; despachos: number; viajes: number };
        const semMap = new Map<string, SemEntry>();

        // Distribuir producción por días entre droneos (igual que web)
        for (let si = 1; si < yearRows.length; si++) {
          const r    = yearRows[si] as Record<string, number | string | null>;
          const prev = yearRows[si - 1] as Record<string, number | string | null>;

          const prevDate = new Date((prev.fecha as string) + "T12:00:00");
          const currDate = new Date((r.fecha    as string) + "T12:00:00");

          // Días: desde el día siguiente al droneo anterior hasta el droneo actual (inclusive)
          const days: Date[] = [];
          const cur = new Date(prevDate);
          cur.setDate(cur.getDate() + 1);
          while (cur <= currDate) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
          const n = Math.max(days.length, 1);

          const prodDrone = (r.produccion_drone    as number) ?? 0;
          const prodPeso  = (r.produccion_pesometro as number | null) ?? ((r.productividad_pesometro as number ?? 0) * (r.horas_reales as number ?? 0));
          const hrsProd   = (r.diferencia_horometro as number | null) ?? (r.horas_reales as number ?? 0);
          const detencion = (r.detencion            as number) ?? 0;
          const despachos = (r.despachos_ton        as number) ?? 0;
          const viajes    = (r.cantidad_despachos   as number) ?? 0;

          for (const day of days) {
            const key  = isoWeekKey(day);
            const acc  = semMap.get(key) ?? { prodDrone: 0, prodPeso: 0, hrsProd: 0, detencion: 0, despachos: 0, viajes: 0 };
            acc.prodDrone  += prodDrone / n;
            acc.prodPeso   += prodPeso  / n;
            acc.hrsProd    += hrsProd   / n;
            acc.detencion  += detencion / n;
            acc.despachos  += despachos / n;
            acc.viajes     += viajes    / n;
            semMap.set(key, acc);
          }
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
