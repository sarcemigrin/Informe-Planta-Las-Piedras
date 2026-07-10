/**
 * POST /api/chat
 *
 * Chatbot de Arena Control.
 * KPI semanal calculado con el MISMO criterio que la seccion Informe:
 * distribucion proporcional de produccion/horas entre dias del periodo
 * (igual a calcularDiario en calculations.ts).
 *
 * Formula: KPI semana = sum(prod_dia) / sum((horas-detencion)_dia)
 */

import { NextResponse }      from "next/server";
import { getServerSession }  from "next-auth/next";
import { authOptions }       from "@/lib/authOptions";
import { requireJson }       from "@/lib/apiGuard";
import { createClient }      from "@supabase/supabase-js";
import Groq                  from "groq-sdk";

export const dynamic = "force-dynamic";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// ISO week (identico a getWeek en calculations.ts)
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

type Rec = { fecha: string; hora: string; produccion_drone: number; horas_reales: number; detencion: number; inventario_ton: number; despachos_ton: number; productividad_drone: number };

// Distribuye produccion/horas entre dias del periodo (igual que calcularDiario)
function agruparPorSemana(records: Rec[]): Record<number, { prod: number; hrOp: number; desp: number; inv: number; firstDate: string; lastDate: string }> {
  const byWeek: Record<number, { prod: number; hrOp: number; desp: number; inv: number; firstDate: string; lastDate: string }> = {};

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];

    const prevDate = new Date(prev.fecha + "T12:00:00");
    const currDate = new Date(curr.fecha + "T12:00:00");
    const diasPeriodo = Math.max(
      1,
      Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    const prodDia = (curr.produccion_drone ?? 0) / diasPeriodo;
    const hrsDia  = (curr.horas_reales    ?? 0) / diasPeriodo;
    const detDia  = (curr.detencion       ?? 0) / diasPeriodo;
    const despDia = (curr.despachos_ton   ?? 0) / diasPeriodo;

    for (let d = 1; d <= diasPeriodo; d++) {
      const dia = new Date(prevDate);
      dia.setDate(dia.getDate() + d);
      const wk = isoWeek(dia);
      const fechaStr = dia.toISOString().slice(0, 10);

      if (!byWeek[wk]) byWeek[wk] = { prod: 0, hrOp: 0, desp: 0, inv: 0, firstDate: fechaStr, lastDate: fechaStr };
      byWeek[wk].prod  += prodDia;
      byWeek[wk].hrOp  += Math.max(0, hrsDia - detDia);
      byWeek[wk].desp  += despDia;
      byWeek[wk].lastDate = fechaStr;
    }
    // Inventario: usar el del ultimo registro de la semana
    const wkCurr = isoWeek(currDate);
    if (byWeek[wkCurr]) byWeek[wkCurr].inv = curr.inventario_ton ?? 0;
  }

  return byWeek;
}

function agruparPorMes(records: Rec[]): Record<number, { prod: number; hrOp: number; desp: number }> {
  const byMonth: Record<number, { prod: number; hrOp: number; desp: number }> = {};

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];

    const prevDate = new Date(prev.fecha + "T12:00:00");
    const currDate = new Date(curr.fecha + "T12:00:00");
    const diasPeriodo = Math.max(
      1,
      Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    const prodDia = (curr.produccion_drone ?? 0) / diasPeriodo;
    const hrsDia  = (curr.horas_reales    ?? 0) / diasPeriodo;
    const detDia  = (curr.detencion       ?? 0) / diasPeriodo;
    const despDia = (curr.despachos_ton   ?? 0) / diasPeriodo;

    for (let d = 1; d <= diasPeriodo; d++) {
      const dia = new Date(prevDate);
      dia.setDate(dia.getDate() + d);
      const m = dia.getMonth() + 1;

      if (!byMonth[m]) byMonth[m] = { prod: 0, hrOp: 0, desp: 0 };
      byMonth[m].prod  += prodDia;
      byMonth[m].hrOp  += Math.max(0, hrsDia - detDia);
      byMonth[m].desp  += despDia;
    }
  }

  return byMonth;
}

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  const [
    { data: arenaAll },
    { data: cuarzoAll },
    despachoResult,
  ] = await Promise.all([
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: true })
      .limit(500),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion_drone, productividad_drone, despachos_ton, horas_reales, detencion")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: true })
      .limit(200),
    Promise.resolve(
      sb.from("despachos")
        .select("fecha, hora, destino, toneladas")
        .order("fecha", { ascending: false })
        .limit(10)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const f = (n: number | null | undefined, dec = 1) =>
    n == null || isNaN(n as number) ? "sin dato"
      : (n as number).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const arena  = (arenaAll  ?? []) as unknown as Rec[];
  const cuarzo = (cuarzoAll ?? []) as unknown as Rec[];
  const despRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  // ---- Semanas (distribucion proporcional = mismo criterio que Informe) ----
  const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const byWeek  = agruparPorSemana(arena);
  const byMonth = agruparPorMes(arena);

  const weekEntries  = Object.entries(byWeek).sort(([a], [b]) => Number(a) - Number(b));
  const monthEntries = Object.entries(byMonth).sort(([a], [b]) => Number(a) - Number(b));

  const weekLines = weekEntries.map(([wk, v]) => {
    const kpi = v.hrOp > 0 ? v.prod / v.hrOp : 0;
    return `  [S${wk}] ${v.firstDate}~${v.lastDate} | kpi: ${f(kpi)} t/h | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t | inv final: ${f(v.inv)} t`;
  }).join("\n");

  const monthLines = monthEntries.map(([m, v]) => {
    const kpi = v.hrOp > 0 ? v.prod / v.hrOp : 0;
    return `  ${MESES[Number(m)].padEnd(12)} | kpi: ${f(kpi)} t/h | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t`;
  }).join("\n");

  // Resumen anio
  let aProd = 0, aDesp = 0;
  for (const v of Object.values(byMonth)) { aProd += v.prod; aDesp += v.desp; }

  // Semana actual (ultima semana con datos)
  const lastWk = weekEntries.length ? weekEntries[weekEntries.length - 1] : null;
  const lastWkNum = lastWk ? lastWk[0] : "?";
  const lastWkV   = lastWk ? lastWk[1] : null;
  const lastWkKpi = lastWkV && lastWkV.hrOp > 0 ? lastWkV.prod / lastWkV.hrOp : null;

  // Ultimo registro arena
  const a0 = arena.length ? arena[arena.length - 1] : ({} as Partial<Rec>);
  const a0wk = a0.fecha ? isoWeek(new Date(a0.fecha + "T12:00:00")) : "?";

  // Ultimo registro cuarzo
  const c0 = cuarzo.length ? cuarzo[cuarzo.length - 1] : ({} as Partial<Rec>);
  const c0wk = c0.fecha ? isoWeek(new Date(c0.fecha + "T12:00:00")) : "?";

  // Historial de droneos (para consultas por fecha puntual — muestra el ultimo mes)
  const arenaHist = [...arena].reverse().slice(0, 20).map(r => {
    const wk = isoWeek(new Date(r.fecha + "T12:00:00"));
    return `  [S${wk}] ${r.fecha} ${r.hora} | prod droneo: ${f(r.produccion_drone)} t | kpi droneo: ${f(r.productividad_drone)} t/h | inv: ${f(r.inventario_ton)} t`;
  }).join("\n");

  const cuarzoHist = [...cuarzo].reverse().slice(0, 10).map(r => {
    const wk = isoWeek(new Date(r.fecha + "T12:00:00"));
    return `  [S${wk}] ${r.fecha} ${r.hora} | inv: ${f(r.inventario_ton)} t | prod: ${f(r.produccion_drone)} t`;
  }).join("\n");

  const despHist = despRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "sin destino"} | ${f(r.toneladas as number)} t`
  ).join("\n");

  return [
    `=== DATOS EN TIEMPO REAL — PLANTA LAS PIEDRAS (${new Date().toLocaleDateString("es-CL")}) ===`,
    `Criterio KPI: mismo que seccion Informe (distribucion proporcional entre dias del periodo).`,
    `KPI = sum(produccion_dia) / sum((horas_reales - detencion)_dia), agrupado por semana ISO.`,
    "",
    `--- SEMANA EN CURSO: S${lastWkNum} (${lastWkV?.firstDate ?? ""}~${lastWkV?.lastDate ?? ""}) ---`,
    lastWkV ? `  KPI semana     : ${f(lastWkKpi as number)} t/h` : "  Sin datos",
    lastWkV ? `  Produccion     : ${f(lastWkV.prod)} ton`        : "",
    lastWkV ? `  Inventario     : ${f(lastWkV.inv)} ton`         : "",
    "",
    `--- ULTIMO REGISTRO ARENA | ${a0.fecha ?? "sin fecha"} ${a0.hora ?? ""} | Semana ISO ${a0wk} ---`,
    `  Productividad droneo : ${f(a0.productividad_drone)} t/h`,
    `  Produccion droneo    : ${f(a0.produccion_drone)} ton`,
    `  Inventario           : ${f(a0.inventario_ton)} ton`,
    "",
    `--- ULTIMO REGISTRO CUARZO | ${c0.fecha ?? "sin fecha"} ${c0.hora ?? ""} | Semana ISO ${c0wk} ---`,
    `  Inventario    : ${f(c0.inventario_ton)} ton`,
    `  Produccion    : ${f(c0.produccion_drone)} ton`,
    `  Productividad : ${f(c0.productividad_drone)} t/h`,
    "",
    `--- KPIS SEMANALES ARENA ${year} (distribucion proporcional, mismo que Informe) ---`,
    weekLines || "  (sin datos)",
    "",
    `--- KPIS MENSUALES ARENA ${year} ---`,
    monthLines || "  (sin datos)",
    "",
    `--- RESUMEN ANIO ${year} ---`,
    `  Produccion acumulada: ${f(aProd)} ton`,
    `  Despachos acumulados: ${f(aDesp)} ton`,
    "",
    "--- HISTORIAL DE DRONEOS (para consultas por fecha puntual) ---",
    arenaHist || "  (sin datos)",
    "",
    "--- HISTORIAL CUARZO ---",
    cuarzoHist || "  (sin datos)",
    "",
    "--- DESPACHOS RECIENTES ---",
    despHist || "  (sin datos)",
  ].join("\n").trim();
}

let _lastContextTime = 0;
let _cachedContext   = "";
const CACHE_MS = 2 * 60 * 1000;

async function getCachedDataContext(): Promise<string> {
  const now = Date.now();
  if (now - _lastContextTime < CACHE_MS && _cachedContext) return _cachedContext;
  _cachedContext   = await getDataContext();
  _lastContextTime = now;
  return _cachedContext;
}

function buildSystemPrompt(dataContext: string): string {
  return [
    "Eres el asistente de Arena Control de Migrin, planta Las Piedras.",
    "",
    "FUENTE DE DATOS: Los datos provienen de la base de datos de la planta en tiempo real.",
    "Son identicos a los que muestra la seccion Informe de la aplicacion.",
    "NUNCA digas que son un documento de ejemplo o que no tienes acceso a datos reales.",
    "",
    "Puedes responder sobre: Dashboard, Control de vuelos, Informe, Inventario, Despachos y operacion general.",
    "",
    "REGLAS (en orden de prioridad):",
    "",
    "1. SEMANA ESPECIFICA (ej. semana 27, S27):",
    "   -> Busca [S27] en KPIS SEMANALES ARENA. Lee el kpi y produccion de esa linea.",
    "   -> Di exactamente: La semana 27 tuvo un KPI de X,X t/h y produccion de X.XXX,X ton.",
    "   -> Si no existe esa semana, di: No tengo datos de la semana XX.",
    "",
    "2. SEMANA ACTUAL / EN CURSO:",
    "   -> Usa la seccion SEMANA EN CURSO directamente.",
    "",
    "3. MES (ej. junio, mes 6):",
    "   -> Busca en KPIS MENSUALES. Reporta kpi y produccion.",
    "",
    "4. ANIO:",
    "   -> Usa RESUMEN ANIO.",
    "",
    "5. FECHA PUNTUAL (ej. 3 de julio):",
    "   -> Busca en HISTORIAL DE DRONEOS si hay registro de esa fecha.",
    "   -> Si no hay, di: No hay droneo registrado el DD/MM. Los mas cercanos son: [menciona 2 fechas del historial].",
    "",
    "6. VALOR ACTUAL / ULTIMO:",
    "   -> Usa ULTIMO REGISTRO ARENA o CUARZO.",
    "",
    "7. NUNCA calcules, sumes ni promedies. Los KPI ya estan calculados con el mismo criterio que el Informe.",
    "",
    "Responde en espanol. Se breve. Incluye la unidad (ton, t/h, h).",
    "Objetivos: productividad 32 t/h | inventario arena 7.500 ton",
    "",
    dataContext,
  ].join("\n");
}

export async function POST(req: Request) {
  const ctErr = requireJson(req);
  if (ctErr) return ctErr;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY no configurada." }, { status: 503 });
  }

  const body = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages requerido." }, { status: 400 });
  }

  let dataContext = "";
  try {
    dataContext = await getCachedDataContext();
  } catch (e) {
    console.warn("[chat] No se pudo obtener contexto:", e);
    dataContext = "(No se pudieron cargar los datos en este momento)";
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const groqMessages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(dataContext) },
    ...body.messages.slice(-10).map(m => ({
      role:    m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      try {
        const completion = await groq.chat.completions.create({
          model:       "llama-3.3-70b-versatile",
          messages:    groqMessages,
          stream:      true,
          max_tokens:  300,
          temperature: 0.05,
        });
        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[chat] Groq error:", msg);
        controller.enqueue(encoder.encode(`[Error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":           "text/plain; charset=utf-8",
      "Cache-Control":          "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
