/**
 * POST /api/informe/send-visual
 * Recibe el PDF ya generado (base64) desde el cliente,
 * lo sube a OneDrive y lo envia por correo.
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
      return NextResponse.json({ error: "Sin token de acceso. Vuelve a iniciar sesion." }, { status: 401 });
    }

    const { pdfBase64, fecha, kpiSummary } = await req.json() as {
      pdfBase64: string;
      fecha: string;
      kpiSummary?: {
        kpiDrone?: number;
        prodDrone?: number;
        detencion?: number;
        inventario?: number;
        horas?: number;
        kpiPesometro?: number;
      };
    };

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
      body:    Buffer.from(pdfBytes),
    });
    let driveUrl: string | null = null;
    if (upRes.ok) {
      const j = await upRes.json() as { webUrl?: string };
      driveUrl = j.webUrl ?? null;
      console.log("[send-visual] OneDrive OK:", driveUrl);
    } else {
      console.error("[send-visual] OneDrive fail:", upRes.status, await upRes.text());
    }

    // 2. Enviar email
    const recipientsRaw = await getConfig("report_recipients", "");
    let activeRecipients: { email: string; nombre: string; activo: boolean }[] = [];
    if (recipientsRaw) {
      try { activeRecipients = JSON.parse(recipientsRaw); } catch { /* ignore */ }
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
      console.warn("[send-visual] Sin destinatarios configurados");
      return NextResponse.json({ ok: true, driveUrl, emailOk: false });
    }

    const fechaFmt = fecha ? fecha.split("-").reverse().join("/") : "";

    const fmtKpi = (v: number | undefined, dec = 1): string =>
      v !== undefined && isFinite(v)
        ? v.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec })
        : "-";

    const kpiOk    = (kpiSummary?.kpiDrone ?? 0) >= 32;
    const kpiColor = kpiOk ? "#22c55e" : "#ef4444";
    const detColor = (kpiSummary?.detencion ?? 0) > 0 ? "#ef4444" : "#374151";

    function kpiCell(bg: string, bdr: string, lbl: string, val: string, unit: string, vc: string): string {
      return '<td style="background:' + bg + ';border:1px solid ' + bdr + ';border-radius:6px;'
        + 'padding:12px 10px;text-align:center;width:25%">'
        + '<div style="font-size:10px;color:#6b7280;margin-bottom:4px">' + lbl + '</div>'
        + '<div style="font-size:18px;font-weight:700;color:' + vc + '">' + val + '</div>'
        + '<div style="font-size:10px;color:#6b7280">' + unit + '</div></td>';
    }

    let kpiCards = "";
    if (kpiSummary) {
      kpiCards =
        '<table cellpadding="0" cellspacing="0" style="width:100%;margin:14px 0"><tr>'
        + '<td style="background:#374151;border-radius:6px;padding:12px 10px;text-align:center;width:25%">'
        + '<div style="font-size:10px;color:#9ca3af;margin-bottom:4px">KPI DRONE</div>'
        + '<div style="font-size:22px;font-weight:700;color:' + kpiColor + '">' + fmtKpi(kpiSummary.kpiDrone) + '</div>'
        + '<div style="font-size:10px;color:#6b7280">t/h</div></td>'
        + kpiCell("#f0f9ff","#bfdbfe","PROD. DRONE", fmtKpi(kpiSummary.prodDrone,0),"ton","#374151")
        + kpiCell("#f0fdf4","#bbf7d0","HRS PRODUCCION", fmtKpi(kpiSummary.horas),"hrs","#374151")
        + kpiCell("#fef3c7","#fde68a","DETENCION", fmtKpi(kpiSummary.detencion),"hrs",detColor)
        + "</tr></table>";
    }

    const htmlContent = [
      '<div style="font-family:Arial,sans-serif;color:#374151;max-width:580px;margin:0 auto">',
      '<div style="background:#374151;padding:20px 24px;border-left:6px solid #6BCF7F">',
      '<h2 style="color:#fff;margin:0;font-size:18px">Informe de Produccion Arena</h2>',
      '<p style="color:#94a3b8;margin:5px 0 0;font-size:12px">Planta Las Piedras - ' + fechaFmt + '</p>',
      "</div>",
      '<div style="padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none">',
      kpiCards,
      '<p style="font-size:13px;margin:0">Adjunto encontrara el informe de produccion.</p>',
      driveUrl ? '<p style="margin:10px 0 0;font-size:13px">OneDrive: <a href="' + driveUrl + '" style="color:#16a34a">' + fileName + '</a></p>' : "",
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">',
      '<p style="margin:0;font-size:11px;color:#9ca3af">Generado por: ' + (session.user?.email ?? "sistema") + '</p>',
      "</div></div>",
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
