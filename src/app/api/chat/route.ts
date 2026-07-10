/**
 * POST /api/chat — Chatbot Arena Control.
 * KPI semanal = distribucion proporcional entre dias (mismo criterio que Informe).
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

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

type Rec = {
  fecha: string; hora: string;
  produccion_drone: number; productividad_drone: number;
  inventario_ton: number; horas_reales: number;
  detencion: number; despachos_ton: number;
};

function agruparPorSemana(records: Rec[]) {
  const byWeek: Record<number, { prod: number; hrOp: number; desp: number; inv: number; firstDate: string; lastDate: string }> = {};
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];
    const prevDate = new Date(prev.fecha + "T12:00:00");
    const currDate = new Date(curr.fecha + "T12:00:00");
    const dias = Math.max(1, Math.round((currDate.getTime() - prevDate.getTime()) / 86400000));
    const prodD = (curr.produccion_drone ?? 0) / dias;
    const hrsD  = (curr.horas_reales    ?? 0) / dias;
    const detD  = (curr.detencion       ?? 0) / dias;
    const despD = (curr.despachos_ton   ?? 0) / dias;
    for (let d = 1; d <= dias; d++) {
      const dia = new Date(prevDate);
      dia.setDate(dia.getDate() + d);
      const wk  = isoWeek(dia);
      const fStr = dia.toISOString().slice(0, 10);
      if (!byWeek[wk]) byWeek[wk] = { prod: 0, hrOp: 0, desp: 0, inv: 0, firstDate: fStr, lastDate: fStr };
      byWeek[wk].prod += prodD;
      byWeek[wk].hrOp += Math.max(0, hrsD - detD);
      byWeek[wk].desp += despD;
      byWeek[wk].lastDate = fStr;
    }
    const wkC = isoWeek(currDate);
    if (byWeek[wkC]) byWeek[wkC].inv = curr.inventario_ton ?? 0;
  }
  return byWeek;
}

function agruparPorMes(records: Rec[]) {
  const byMonth: Record<number, { prod: number; hrOp: number; desp: number }> = {};
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];
    const prevDate = new Date(prev.fecha + "T12:00:00");
    const currDate = new Date(curr.fecha + "T12:00:00");
    const dias = Math.max(1, Math.round((currDate.getTime() - prevDate.getTime()) / 86400000));
    const prodD = (curr.produccion_drone ?? 0) / dias;
    const hrsD  = (curr.horas_reales    ?? 0) / dias;
    const detD  = (curr.detencion       ?? 0) / dias;
    const despD = (curr.despachos_ton   ?? 0) / dias;
    for (let d = 1; d <= dias; d++) {
      const dia = new Date(prevDate);
      dia.setDate(dia.getDate() + d);
      const m = dia.getMonth() + 1;
      if (!byMonth[m]) byMonth[m] = { prod: 0, hrOp: 0, desp: 0 };
      byMonth[m].prod += prodD;
      byMonth[m].hrOp += Math.max(0, hrsD - detD);
      byMonth[m].desp += despD;
    }
  }
  return byMonth;
}

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  const [{ data: arenaAll }, { data: cuarzoAll }, despachoResult] = await Promise.all([
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .gte("fecha", `${year}-01-01`).order("fecha_hora", { ascending: true }).limit(500),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion_drone, productividad_drone, despachos_ton, horas_reales, detencion")
      .gte("fecha", `${year}-01-01`).order("fecha_hora", { ascending: true }).limit(200),
    Promise.resolve(
      sb.from("despachos").select("fecha, hora, destino, toneladas")
        .order("fecha", { ascending: false }).limit(10)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const f = (n: number | null | undefined, dec = 1) =>
    n == null || isNaN(n as number) ? "sin dato"
      : (n as number).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const arena    = (arenaAll  ?? []) as unknown as Rec[];
  const cuarzo   = (cuarzoAll ?? []) as unknown as Rec[];
  const despRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  const byWeek  = agruparPorSemana(arena);
  const byMonth = agruparPorMes(arena);

  const weekEntries  = Object.entries(byWeek).sort(([a],[b]) => Number(a)-Number(b));
  const monthEntries = Object.entries(byMonth).sort(([a],[b]) => Number(a)-Number(b));

  const weekLines = weekEntries.map(([wk, v]) => {
    const kpi = v.hrOp > 0 ? v.prod / v.hrOp : 0;
    return `  [S${wk}] ${v.firstDate}~${v.lastDate} | kpi: ${f(kpi)} t/h | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t | inv: ${f(v.inv)} t`;
  }).join("\n");

  const monthLines = monthEntries.map(([m, v]) => {
    const kpi = v.hrOp > 0 ? v.prod / v.hrOp : 0;
    return `  ${MESES[Number(m)].padEnd(12)} | kpi: ${f(kpi)} t/h | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t`;
  }).join("\n");

  let aProd = 0, aDesp = 0;
  for (const v of Object.values(byMonth)) { aProd += v.prod; aDesp += v.desp; }

  const lastWk  = weekEntries.length ? weekEntries[weekEntries.length - 1] : null;
  const lastWkN = lastWk ? lastWk[0] : "?";
  const lastWkV = lastWk ? lastWk[1] : null;
  const lastWkKpi = lastWkV && lastWkV.hrOp > 0 ? lastWkV.prod / lastWkV.hrOp : null;

  const a0   = arena.length  ? arena[arena.length - 1]   : ({} as Partial<Rec>);
  const c0   = cuarzo.length ? cuarzo[cuarzo.length - 1] : ({} as Partial<Rec>);
  const a0wk = a0.fecha ? isoWeek(new Date(a0.fecha + "T12:00:00")) : "?";
  const c0wk = c0.fecha ? isoWeek(new Date(c0.fecha + "T12:00:00")) : "?";

  const arenaHist = [...arena].reverse().slice(0, 20).map(r => {
    const wk = isoWeek(new Date(r.fecha + "T12:00:00"));
    return `  [S${wk}] ${r.fecha} ${r.hora} | prod: ${f(r.produccion_drone)} t | kpi droneo: ${f(r.productividad_drone)} t/h | inv: ${f(r.inventario_ton)} t`;
  }).join("\n");

  const cuarzoHist = [...cuarzo].reverse().slice(0, 10).map(r => {
    const wk = isoWeek(new Date(r.fecha + "T12:00:00"));
    return `  [S${wk}] ${r.fecha} ${r.hora} | inv: ${f(r.inventario_ton)} t | prod: ${f(r.produccion_drone)} t`;
  }).join("\n");

  const despHist = despRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "sin destino"} | ${f(r.toneladas as number)} t`
  ).join("\n");

  return [
    `=== DATOS EN TIEMPO REAL (${new Date().toLocaleDateString("es-CL")}) ===`,
    "KPI = sum(prod_dia) / sum((horas-detencion)_dia) — mismo criterio que seccion Informe.",
    "",
    `[SEMANA EN CURSO S${lastWkN}: ${lastWkV?.firstDate ?? ""}~${lastWkV?.lastDate ?? ""}]`,
    lastWkV ? `  KPI: ${f(lastWkKpi as number)} t/h | prod: ${f(lastWkV.prod)} t | inv: ${f(lastWkV.inv)} t` : "  sin datos",
    "",
    `[ULTIMO REGISTRO ARENA: ${a0.fecha ?? "?"} ${a0.hora ?? ""} S${a0wk}]`,
    `  kpi droneo: ${f(a0.productividad_drone)} t/h | prod: ${f(a0.produccion_drone)} t | inv: ${f(a0.inventario_ton)} t`,
    "",
    `[ULTIMO REGISTRO CUARZO: ${c0.fecha ?? "?"} ${c0.hora ?? ""} S${c0wk}]`,
    `  inv: ${f(c0.inventario_ton)} t | prod: ${f(c0.produccion_drone)} t | kpi: ${f(c0.productividad_drone)} t/h`,
    "",
    `[KPIS SEMANALES ARENA ${year}]`,
    weekLines || "  sin datos",
    "",
    `[KPIS MENSUALES ARENA ${year}]`,
    monthLines || "  sin datos",
    "",
    `[RESUMEN ANIO ${year}]`,
    `  prod acumulada: ${f(aProd)} t | despachos: ${f(aDesp)} t`,
    "",
    "[HISTORIAL DRONEOS — para consultas por fecha puntual]",
    arenaHist || "  sin datos",
    "",
    "[HISTORIAL CUARZO]",
    cuarzoHist || "  sin datos",
    "",
    "[DESPACHOS RECIENTES]",
    despHist || "  sin datos",
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
    "Los datos provienen de la base de datos en tiempo real. Son reales, no ejemplos.",
    "Nunca digas que no tienes acceso a datos reales o que son un documento de texto.",
    "",
    "Puedes responder sobre: Dashboard, Control de vuelos, Informe, Inventario, Despachos y operacion de la planta.",
    "",
    "--- COMO RESPONDER ---",
    "",
    "A) DATO PUNTUAL (el usuario pide el valor de una semana, mes, fecha o el actual):",
    "   Lee directamente del contexto sin recalcular el KPI.",
    "   - Semana especifica (ej. S27): busca [S27] en KPIS SEMANALES. Reporta kpi y produccion.",
    "     Si no existe: 'No tengo datos de la semana XX para este anio.'",
    "   - Semana actual: usa SEMANA EN CURSO.",
    "   - Mes: usa KPIS MENSUALES.",
    "   - Anio: usa RESUMEN ANIO.",
    "   - Fecha puntual: busca en HISTORIAL DRONEOS.",
    "     Si no hay registro exacto, di: 'No hay droneo el DD/MM.'",
    "     Luego ofrece los 2 droneos mas proximos del historial.",
    "   - Valor actual: usa ULTIMO REGISTRO ARENA o CUARZO.",
    "",
    "B) ANALISIS, PROMEDIOS O TENDENCIAS (el usuario pide comparar, promediar o analizar un periodo):",
    "   Puedes calcular usando los datos ya disponibles en el contexto.",
    "   - Promedio de produccion: suma las producciones de las semanas/meses indicados y divide.",
    "   - Tendencia: compara KPI semanales y describe si sube, baja o se mantiene.",
    "   - Mejor/peor semana o mes: revisa KPIS SEMANALES o MENSUALES y reporta el extremo.",
    "   - Siempre menciona que semanas o meses usaste en el calculo.",
    "",
    "REGLA CRITICA: para el KPI de una semana o mes especifico, usa SIEMPRE el valor",
    "pre-calculado del contexto (calculado con el mismo criterio que el Informe).",
    "Solo cuando el usuario pide un promedio o analisis de MULTIPLES periodos puedes operar sobre esos valores.",
    "",
    "Responde en espanol. Se claro y directo. Incluye la unidad (ton, t/h, h).",
    "Referencia: objetivo KPI 32 t/h | objetivo inventario arena 7.500 ton",
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
          max_tokens:  400,
          temperature: 0.1,
        });
        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[chat] Groq error:", msg);
        controller.enqueue(encoder.encode("[Error: " + msg + "]"));
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
