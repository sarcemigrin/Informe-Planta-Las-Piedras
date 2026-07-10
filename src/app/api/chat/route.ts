/**
 * POST /api/chat
 *
 * Chatbot de Arena Control.
 * Estrategia: el servidor pre-calcula KPIs semanales (mismo criterio que Informe)
 * y los entrega listos al LLM. El LLM solo lee y reporta — nunca calcula.
 *
 * Formula KPI semanal: sum(produccion_drone) / sum(horas_reales - detencion)
 * Equivale a: sum(produccion_drone) / sum(diferencia_horometro)
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

// Numero de semana ISO a partir de "YYYY-MM-DD"
function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startW1 = new Date(jan4);
  startW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return Math.floor((d.getTime() - startW1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  const [
    { data: arenaYear },
    { data: cuarzoYear },
    despachoResult,
  ] = await Promise.all([
    // Todos los registros del anio para calcular semanas y meses
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

  const arena    = (arenaYear   ?? []) as Record<string, string | number | null>[];
  const cuarzo   = (cuarzoYear  ?? []) as Record<string, string | number | null>[];
  const despRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  // ---------------------------------------------------------------
  // KPIS SEMANALES ARENA (misma formula que Informe)
  // KPI semana = sum(produccion_drone) / sum(horas_reales - detencion)
  // ---------------------------------------------------------------
  type WeekAgg = { prod: number; hrOp: number; desp: number; inv: number; firstDate: string; lastDate: string; cnt: number };
  const byWeek: Record<number, WeekAgg> = {};

  for (const r of arena) {
    if (!r.fecha) continue;
    const wk   = isoWeek(r.fecha as string);
    const prod = (r.produccion_drone as number) ?? 0;
    const hrs  = (r.horas_reales    as number) ?? 0;
    const det  = (r.detencion       as number) ?? 0;
    const desp = (r.despachos_ton   as number) ?? 0;
    const inv  = (r.inventario_ton  as number) ?? 0;
    if (!byWeek[wk]) byWeek[wk] = { prod: 0, hrOp: 0, desp: 0, inv: 0, firstDate: r.fecha as string, lastDate: r.fecha as string, cnt: 0 };
    byWeek[wk].prod  += prod;
    byWeek[wk].hrOp  += Math.max(0, hrs - det);
    byWeek[wk].desp  += desp;
    byWeek[wk].inv    = inv;           // ultimo inventario de la semana
    byWeek[wk].lastDate = r.fecha as string;
    byWeek[wk].cnt++;
  }

  const weekEntries = Object.entries(byWeek).sort(([a], [b]) => Number(a) - Number(b));
  const weekLines   = weekEntries.map(([wk, v]) => {
    const kpi = v.hrOp > 0 ? v.prod / v.hrOp : 0;
    return `  [S${wk}] ${v.firstDate}~${v.lastDate} | kpi: ${f(kpi)} t/h | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t | inv final: ${f(v.inv)} t | ${v.cnt} droneo(s)`;
  }).join("\n");

  // ---------------------------------------------------------------
  // KPIS MENSUALES ARENA
  // ---------------------------------------------------------------
  const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  type MonthAgg = { prod: number; desp: number; hrOp: number };
  const byMonth: Record<number, MonthAgg> = {};
  let aProd = 0, aDesp = 0;

  for (const r of arena) {
    if (!r.fecha) continue;
    const m    = parseInt((r.fecha as string).slice(5, 7), 10);
    const prod = (r.produccion_drone as number) ?? 0;
    const desp = (r.despachos_ton   as number) ?? 0;
    const hrs  = (r.horas_reales    as number) ?? 0;
    const det  = (r.detencion       as number) ?? 0;
    aProd += prod;
    aDesp += desp;
    if (!byMonth[m]) byMonth[m] = { prod: 0, desp: 0, hrOp: 0 };
    byMonth[m].prod  += prod;
    byMonth[m].desp  += desp;
    byMonth[m].hrOp  += Math.max(0, hrs - det);
  }

  const monthLines = Object.entries(byMonth)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([m, v]) => {
      const kpi = v.hrOp > 0 ? v.prod / v.hrOp : 0;
      return `  ${MESES[Number(m)].padEnd(12)} | kpi: ${f(kpi)} t/h | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t`;
    }).join("\n");

  // ---------------------------------------------------------------
  // ULTIMO REGISTRO (actual)
  // ---------------------------------------------------------------
  const a0   = arena.length   ? arena[arena.length - 1]   : {};
  const c0   = cuarzo.length  ? cuarzo[cuarzo.length - 1] : {};
  const a0wk = a0.fecha ? isoWeek(a0.fecha as string) : "?";
  const c0wk = c0.fecha ? isoWeek(c0.fecha as string) : "?";

  // Semana actual (ultima semana con datos)
  const lastWkKey  = weekEntries.length ? weekEntries[weekEntries.length - 1][0] : null;
  const lastWkData = lastWkKey ? byWeek[Number(lastWkKey)] : null;
  const lastWkKpi  = lastWkData && lastWkData.hrOp > 0 ? lastWkData.prod / lastWkData.hrOp : null;

  // Historial de droneos (para consultas por fecha puntual)
  const arenaHist = [...arena].reverse().slice(0, 20).map(r => {
    const wk = r.fecha ? `S${isoWeek(r.fecha as string)}` : "S?";
    return `  [${wk}] ${r.fecha} ${r.hora} | prod: ${f(r.produccion_drone as number)} t | kpi droneo: ${f(r.productividad_drone as number)} t/h | inv: ${f(r.inventario_ton as number)} t`;
  }).join("\n");

  const cuarzoHist = [...cuarzo].reverse().slice(0, 10).map(r => {
    const wk = r.fecha ? `S${isoWeek(r.fecha as string)}` : "S?";
    return `  [${wk}] ${r.fecha} ${r.hora} | inv: ${f(r.inventario_ton as number)} t | prod: ${f(r.produccion_drone as number)} t`;
  }).join("\n");

  const despHist = despRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "sin destino"} | ${f(r.toneladas as number)} t`
  ).join("\n");

  return [
    `=== DATOS EN TIEMPO REAL — PLANTA LAS PIEDRAS (${new Date().toLocaleDateString("es-CL")}) ===`,
    "(Fuente: Supabase. KPI = sum(produccion_drone) / sum(horas_reales - detencion). Mismo criterio que Informe.)",
    "",
    `--- ULTIMO REGISTRO ARENA | ${a0.fecha ?? "sin fecha"} ${a0.hora ?? ""} | Semana ISO ${a0wk} ---`,
    `  Productividad droneo : ${f(a0.productividad_drone as number)} t/h`,
    `  Produccion droneo    : ${f(a0.produccion_drone as number)} ton`,
    `  Inventario           : ${f(a0.inventario_ton as number)} ton`,
    `  Hs. operacion        : ${f(a0.horas_reales as number)} h`,
    `  Hs. detencion        : ${f(a0.detencion as number)} h`,
    "",
    `--- ULTIMO REGISTRO CUARZO | ${c0.fecha ?? "sin fecha"} ${c0.hora ?? ""} | Semana ISO ${c0wk} ---`,
    `  Inventario    : ${f(c0.inventario_ton as number)} ton`,
    `  Produccion    : ${f(c0.produccion_drone as number)} ton`,
    `  Productividad : ${f(c0.productividad_drone as number)} t/h`,
    "",
    `--- SEMANA EN CURSO: S${lastWkKey ?? "?"} (${lastWkData?.firstDate ?? ""}~${lastWkData?.lastDate ?? ""}) ---`,
    lastWkData
      ? `  KPI semana   : ${f(lastWkKpi as number)} t/h (${lastWkData.cnt} droneo(s))`
      : "  Sin datos",
    lastWkData ? `  Produccion   : ${f(lastWkData.prod)} ton` : "",
    lastWkData ? `  Inventario   : ${f(lastWkData.inv)} ton`  : "",
    "",
    `--- KPIS SEMANALES ARENA ${year} (usar para preguntas por semana especifica) ---`,
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
  const lines = [
    "Eres el asistente de Arena Control de Migrin, planta Las Piedras.",
    "",
    "FUENTE DE DATOS: Los datos provienen DIRECTAMENTE de la base de datos de la planta (Supabase),",
    "consultada en tiempo real. Son registros reales. NUNCA digas que son un documento o texto de ejemplo.",
    "",
    "Puedes responder sobre: Dashboard, Control de vuelos, Informe, Inventario, Despachos, operacion general.",
    "",
    "REGLAS ESTRICTAS (seguir en orden de prioridad):",
    "",
    "1. PREGUNTA POR SEMANA (ej. 'semana 27', 'S27'):",
    "   -> Busca en KPIS SEMANALES el renglon [S27].",
    "   -> Reporta el KPI, produccion e inventario que aparecen ahi. NO calcules nada.",
    "   -> Si no existe esa semana, di: 'No tengo datos de la semana XX en el anio en curso.'",
    "",
    "2. PREGUNTA POR SEMANA ACTUAL / EN CURSO:",
    "   -> Usa la seccion SEMANA EN CURSO directamente.",
    "",
    "3. PREGUNTA POR MES (ej. 'junio', 'mes 6'):",
    "   -> Busca en KPIS MENSUALES el renglon del mes. Reporta KPI, produccion, despachos.",
    "",
    "4. PREGUNTA POR ANIO:",
    "   -> Usa RESUMEN ANIO.",
    "",
    "5. PREGUNTA POR FECHA PUNTUAL (ej. '3 de julio', '2026-07-03'):",
    "   -> Busca en HISTORIAL DE DRONEOS si hay un registro de esa fecha exacta.",
    "   -> Si no hay, responde: 'No hay droneo registrado el DD/MM. Los mas cercanos son: [lista las 2 fechas mas proximas del historial].'",
    "",
    "6. PREGUNTA POR VALOR ACTUAL / ULTIMO:",
    "   -> Usa ULTIMO REGISTRO ARENA o CUARZO.",
    "",
    "7. NUNCA sumes, promedies ni calcules. Todos los KPI ya estan calculados con el criterio del Informe.",
    "8. Si el usuario pregunta 'como se calcula', explica: KPI = produccion total / horas operacion netas.",
    "",
    "Responde siempre en espanol. Se breve y directo. Incluye siempre la unidad (ton, t/h, h).",
    "Objetivos: productividad 32 t/h | inventario arena 7.500 ton",
    "",
    dataContext,
  ];
  return lines.join("\n");
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
