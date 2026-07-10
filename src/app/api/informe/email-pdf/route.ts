/**
 * POST /api/informe/email-pdf
 *
 * Recibe dos imágenes PNG (base64) capturadas desde el informe web y las
 * convierte en un PDF de 2 páginas que se envía por email a los destinatarios
 * configurados. Usa pdf-lib solo para componer las imágenes — no recalcula datos.
 *
 * Body: { images: [string, string], label: string }
 *   images[0] = sección "Por Cubicación" (PNG base64)
 *   images[1] = sección "Por Semana"    (PNG base64)
 *   label     = texto libre para el subject, ej. "28/06/2025 09:45"
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken }         from "next-auth/jwt";
import { authOptions }      from "@/lib/authOptions";
import { requireJson }      from "@/lib/apiGuard";
import { createClient }     from "@supabase/supabase-js";
import { PDFDocument }      from "pdf-lib";

export const dynamic = "force-dynamic";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

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

async function buildPdf(pngBase64List: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  for (const b64 of pngBase64List) {
    // Eliminar posible prefijo "data:image/png;base64,"
    const raw = b64.replace(/^data:image\/\w+;base64,/, "");
    const bytes = Buffer.from(raw, "base64");
    const img   = await pdfDoc.embedPng(bytes);

    // A4 landscape: 841.89 × 595.28 pts  (297mm × 210mm)
    const W = 841.89;
    const H = 595.28;

    const page  = pdfDoc.addPage([W, H]);
    const scale = Math.min(W / img.width, H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const ox    = (W - dw) / 2;
    const oy    = (H - dh) / 2;

    page.drawImage(img, { x: ox, y: oy, width: dw, height: dh });
  }

  return pdfDoc.save();
}

async function getRecipients(
): Promise<{ emailAddress: { address: string } }[]> {
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
  return activeList
    .filter(r => r.activo && r.email)
    .map(r => ({ emailAddress: { address: r.email } }));
}

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

    const body = await req.json() as { images: string[]; label?: string };
    const { images, label = "" } = body;

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "Se requiere al menos una imagen." }, { status: 400 });
    }

    // 1. Construir PDF desde las imágenes
    const pdfBytes  = await buildPdf(images);
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
    const fileName  = `informe-arena-${label.replace(/[/ :]/g, "-")}.pdf`;

    // 2. Destinatarios
    const recipients = await getRecipients();
    if (recipients.length === 0) {
      return NextResponse.json({ error: "Sin destinatarios configurados." }, { status: 400 });
    }

    // 3. Enviar email
    const subject  = `Informe Arena — ${label}`;
    const bodyHtml =
      `<div style="background:#f8fafc;padding:32px 24px;font-family:Arial,sans-serif;color:#374151">` +
      `<h2 style="margin:0 0 8px;color:#374151">Informe Productividad Arena</h2>` +
      `<p style="margin:0;color:#6b7280;font-size:14px">${label}</p>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">` +
      `El informe completo se adjunta como PDF.</p>` +
      `</div>`;

    const graphBody = {
      message: {
        subject,
        body:         { contentType: "HTML", content: bodyHtml },
        toRecipients: recipients,
        attachments:  [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name:         fileName,
            contentType:  "application/pdf",
            contentBytes: pdfBase64,
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
      body: JSON.stringify(graphBody),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[email-pdf] sendMail failed:", res.status, err);
      return NextResponse.json({ error: `Error al enviar email: ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, fileName, recipients: recipients.length });
  } catch (e: unknown) {
    console.error("[email-pdf] unhandled error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
