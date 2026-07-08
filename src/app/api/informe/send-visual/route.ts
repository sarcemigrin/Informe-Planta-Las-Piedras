/**
 * POST /api/informe/send-visual
 * Recibe el PDF ya generado (base64) desde el cliente,
 * lo sube a OneDrive y lo envía por correo.
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

    const { pdfBase64, fecha } = await req.json() as { pdfBase64: string; fecha: string };
    const pdfBytes = Buffer.from(pdfBase64, "base64");
    const fileName = "Informe-Arena-" + (fecha ?? new Date().toISOString().slice(0,10)) + ".pdf";

    // 1. Subir a OneDrive
    const folder = (await getConfig("report_onedrive_path", "Informes Cubicacion")).trim();
    const path   = encodeURIComponent(folder + "/" + fileName);
    const uploadUrl = "https://graph.microsoft.com/v1.0/me/drive/root:/" + path + ":/content";

    console.log("[send-visual] Uploading:", folder, "/", fileName);
    const upRes = await fetch(uploadUrl, {
      method:  "PUT",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/pdf" },
      body:    pdfBytes,
    });
    let driveUrl: string | null = null;
    if (upRes.ok) {
      const j = await upRes.json() as { webUrl?: string };
      driveUrl = j.webUrl ?? null;
      console.log("[send-visual] OneDrive OK:", driveUrl);
    } else {
      console.error("[send-visual] OneDrive fail:", upRes.status, await upRes.text());
    }

    // 2. Enviar email — leer destinatarios activos desde report_recipients (JSON)
    const recipientsRaw = await getConfig("report_recipients", "");
    let activeRecipients: { email: string; nombre: string; activo: boolean }[] = [];
    if (recipientsRaw) {
      try { activeRecipients = JSON.parse(recipientsRaw); } catch { /* ignore */ }
    }
    // Fallback legacy: report_email_to (CSV)
    if (activeRecipients.length === 0) {
      const toRaw = await getConfig("report_email_to", "");
      activeRecipients = toRaw.split(",").map(e => e.trim()).filter(Boolean)
        .map(email => ({ email, nombre: "", activo: true }));
    }
    const recipients = activeRecipients
      .filter(r => r.activo && r.email)
      .map(r => ({ emailAddress: { address: r.email } }));

    if (recipients.length === 0) {
      console.warn("[send-visual] Sin destinatarios configurados");
      return NextResponse.json({ ok: true, driveUrl, emailOk: false });
    }

    const fechaFmt = fecha ? fecha.split("-").reverse().join("/") : "";
    const htmlContent = [
      '<div style="font-family:Arial,sans-serif;color:#374151;max-width:520px">',
      '<div style="background:#374151;padding:18px 22px;border-left:5px solid #6BCF7F">',
      '<h2 style="color:#fff;margin:0;font-size:17px">Informe de Produccion Arena</h2>',
      '<p style="color:#94a3b8;margin:4px 0 0;font-size:12px">Planta Las Piedras &middot; ' + fechaFmt + '</p>',
      '</div>',
      '<div style="padding:18px 22px;background:#f6f8fb;font-size:13px;color:#374151">',
      '<p>Adjunto encontrara el informe visual de produccion de arena exportado desde el sistema.</p>',
      driveUrl ? '<p>Tambien fue archivado en OneDrive: <a href="' + driveUrl + '" style="color:#6BCF7F">' + fileName + '</a></p>' : '',
      '<p style="margin-top:12px;font-size:11px;color:#9ca3af">Exportado por: ' + (session.user?.email ?? "sistema") + '</p>',
      '</div></div>',
    ].join("");

    const body = {
      message: {
        subject:      "Informe Produccion Arena - " + fechaFmt,
        body:         { contentType: "HTML", content: htmlContent },
        toRecipients: recipients,
        attachments: [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          name:          fileName,
          contentType:   "application/pdf",
          contentBytes:  pdfBase64,
        }],
      },
      saveToSentItems: false,
    };

    const mailRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method:  "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (!mailRes.ok) {
      const err = await mailRes.text();
      console.error("[send-visual] sendMail fail:", mailRes.status, err);
      return NextResponse.json({ ok: true, driveUrl, emailOk: false, emailError: err });
    }

    console.log("[send-visual] Email enviado OK");
    return NextResponse.json({ ok: true, driveUrl, emailOk: true });

  } catch (e: unknown) {
    console.error("[send-visual] error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
