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
import { generarInformePDF, type InformeData } from "@/lib/informe-pdf";

export const dynamic = "force-dynamic";

// ── helpers Graph API ────────────────────────────────────────────────────────

async function uploadToOneDrive(
  accessToken: string,
  fileName: string,
  pdfBytes: Uint8Array,
): Promise<string | null> {
  const folder = (process.env.REPORT_ONEDRIVE_PATH ?? "Informes Cubicacion").trim();
  const path   = encodeURIComponent(`${folder}/${fileName}`);
  const url    = `https://graph.microsoft.com/v1.0/me/drive/root:/${path}:/content`;

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
  return json.webUrl ?? null;
}

async function sendEmailWithPDF(
  accessToken: string,
  fileName: string,
  pdfBytes: Uint8Array,
  data: InformeData,
  driveUrl: string | null,
): Promise<boolean> {
  const toRaw     = process.env.REPORT_EMAIL_TO ?? "";
  const recipients = toRaw
    .split(",")
    .map(e => e.trim())
    .filter(Boolean)
    .map(address => ({ emailAddress: { address } }));

  if (recipients.length === 0) {
    console.warn("[generate-report] REPORT_EMAIL_TO no configurado — email omitido");
    return false;
  }

  const fechaFmt = data.fecha.split("-").reverse().join("/");
  const subject  = `Informe Cubicación Arena — ${fechaFmt} ${data.hora}`;

  const bodyHtml = `
    <div style="font-family:Arial,sans-serif;color:#374151;max-width:560px">
      <div style="background:#374151;padding:20px 24px;border-left:5px solid #6BCF7F">
        <h2 style="color:#fff;margin:0;font-size:18px">Informe de Cubicación Arena</h2>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">${fechaFmt} &nbsp;·&nbsp; ${data.hora}</p>
      </div>
      <div style="padding:20px 24px;background:#f6f8fb">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:6px 0;color:#6b7280">Productividad Drone</td>
            <td style="padding:6px 0;font-weight:bold;color:#374151;text-align:right">${data.productividad_drone.toFixed(1)} t/h</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280">Productividad Pesómetro</td>
            <td style="padding:6px 0;font-weight:bold;color:#374151;text-align:right">${data.productividad_pesometro.toFixed(1)} t/h</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280">Producción Drone</td>
            <td style="padding:6px 0;font-weight:bold;color:#374151;text-align:right">${Math.round(data.produccion_drone).toLocaleString("es-CL")} ton</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280">Inventario</td>
            <td style="padding:6px 0;font-weight:bold;color:#374151;text-align:right">${Math.round(data.inventario_ton).toLocaleString("es-CL")} ton</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280">Despachos</td>
            <td style="padding:6px 0;font-weight:bold;color:#374151;text-align:right">${Math.round(data.despachos_ton).toLocaleString("es-CL")} ton · ${data.cantidad_despachos} viajes</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280">Horas producción</td>
            <td style="padding:6px 0;font-weight:bold;color:#374151;text-align:right">${data.horas_reales.toFixed(1)} hrs</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280">Detención</td>
            <td style="padding:6px 0;font-weight:bold;color:#ef4444;text-align:right">${data.detencion.toFixed(1)} hrs</td>
          </tr>
        </table>
        ${driveUrl ? `<p style="margin-top:16px;font-size:12px;color:#6b7280">
          PDF archivado en OneDrive: <a href="${driveUrl}" style="color:#6BCF7F">${fileName}</a>
        </p>` : ""}
        <p style="margin-top:8px;font-size:11px;color:#9ca3af">
          Registrado por: ${data.usuario_email ?? "sistema"} — generado automáticamente.
        </p>
      </div>
    </div>
  `;

  const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

  const body = {
    message: {
      subject,
      body:          { contentType: "HTML", content: bodyHtml },
      toRecipients:  recipients,
      attachments:   [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name:          fileName,
          contentType:   "application/pdf",
          contentBytes:  pdfBase64,
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
