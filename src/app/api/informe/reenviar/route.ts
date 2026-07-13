/**
 * POST /api/informe/reenviar
 * Regenera el PDF de un registro existente y lo reenvía por correo.
 * Body: { registroId: string }
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken }         from "next-auth/jwt";
import { authOptions }      from "@/lib/authOptions";
import { requireJson }      from "@/lib/apiGuard";
import { createClient }     from "@supabase/supabase-js";
import { type InformeData, type RegistroResumen, type SemanaStat } from "@/lib/informe-pdf";
import { generarImagenEmail } from "@/lib/email-image";

export const dynamic = "force-dynamic";

const SELECT_FIELDS = "fecha,hora,produccion_drone,productividad_drone,productividad_pesometro,produccion_pesometro,diferencia,diferencia_pesometro,horas_reales,detencion,despachos_ton,cantidad_despachos,inventario_ton";

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

    const [{ data: last10 }, { data: yearRows }, { data: lastCuarzo }] = await Promise.all([
      sb.from("registros_arena").select(SELECT_FIELDS)
        .order("fecha_hora", { ascending: false }).limit(10),
      sb.from("registros_arena").select(SELECT_FIELDS)
        .gte("fecha", yearStart).order("fecha_hora", { ascending: true }),
      sb.from("registros_cuarzo").select("inventario_ton")
        .order("fecha_hora", { ascending: false }).limit(1),
    ]);
    const inventario_cuarzo = (lastCuarzo && lastCuarzo.length > 0)
      ? (lastCuarzo[0] as { inventario_ton: number | null }).inventario_ton
      : null;

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
      inventario_cuarzo,
      usuario_email:           session.user?.email ?? "sistema",
      historial:               ((last10 ?? []) as RegistroResumen[]).reverse(),
      historialChart:          (yearRows ?? []) as RegistroResumen[],
      semanalStats,
    };

    // 5. Leer destinatarios activos desde report_recipients
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
      return NextResponse.json({ ok: true, emailOk: false, error: "Sin destinatarios activos" });
    }

    // 8. Generar imagen PNG del informe para el cuerpo del correo
    const fechaFmt = reg.fecha.split("-").reverse().join("/");
    const cardBuffer = await generarImagenEmail({
      fecha:                   reg.fecha,
      hora:                    reg.hora,
      productividad_drone:     reg.productividad_drone  ?? 0,
      produccion_drone:        reg.produccion_drone     ?? 0,
      inventario_ton:          reg.inventario_ton       ?? 0,
      despachos_ton:           reg.despachos_ton        ?? 0,
      cantidad_despachos:      reg.cantidad_despachos   ?? 0,
      horas_reales:            reg.horas_reales         ?? 0,
      detencion:               reg.detencion            ?? 0,
      inventario_cuarzo,
      usuario_email:           session.user?.email ?? "sistema",
      isReenvio:               true,
    });
    const cardBase64 = cardBuffer.toString("base64");

    // 9. Construir email con imagen CID inline + botón a la app
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://fotogrametria.migrin.cl";
    const htmlContent =
      `<div style="background:#f8fafc;padding:24px 0;text-align:center;font-family:Arial,sans-serif">` +
      `<img src="cid:informe-card@migrin" alt="Informe Cubicacion Arena" ` +
      `style="display:block;margin:0 auto;max-width:560px;width:100%;border:0" />` +
      `<div style="margin-top:20px">` +
      `<a href="${appUrl}" style="display:inline-block;background:#6BCF7F;color:#ffffff;text-decoration:none;` +
      `padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;font-family:Arial,sans-serif">` +
      `Ver en la App →</a></div>` +
      `<p style="margin-top:12px;font-size:11px;color:#9ca3af">Migrin · Faena Las Piedras, Turco y Peral · Reenvío</p>` +
      `</div>`;

    const mailBody = {
      message: {
        subject: "Informe Cubicacion Arena [REENVIO] - " + fechaFmt + " " + reg.hora,
        body: { contentType: "HTML", content: htmlContent },
        toRecipients: recipients,
        attachments: [
          {
            "@odata.type":  "#microsoft.graph.fileAttachment",
            name:           "informe-card.png",
            contentType:    "image/png",
            contentBytes:   cardBase64,
            contentId:      "informe-card@migrin",
            isInline:       true,
          },
        ],
      },
      saveToSentItems: false,
    };

    const mailRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(mailBody),
    });

    return NextResponse.json({ ok: true, emailOk: mailRes.ok });

  } catch (e: unknown) {
    console.error("[reenviar] error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
