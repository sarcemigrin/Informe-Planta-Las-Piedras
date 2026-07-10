/**
 * POST /api/chat
 *
 * Chatbot de Arena Control — responde preguntas en lenguaje natural.
 * Estrategia: el servidor entrega los valores ya listos (último registro),
 * el LLM solo los lee y reporta. Sin cálculos en el modelo.
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

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  const [
    { data: arenaRecent },
    { data: cuarzoRecent },
    { data: arenaYear },
    despachoResult,
  ] = await Promise.all([
    // Ultimos 20 registros para tener varias semanas de historial
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .order("fecha_hora", { ascending: false })
      .limit(20),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(10),
    // Todo el anio actual para agregados mensuales
    sb.from("registros_arena")
      .select("fecha, produccion_drone, productividad_drone, horas_reales, detencion, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha", { ascending: true })
      .limit(300),
    Promise.resolve(
      sb.from("despachos")
        .select("fecha, hora, destino, toneladas")
        .order("fecha", { ascending: false })
        .limit(10)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const f = (n: number | null | undefined, dec = 1) =>
    n == null || isNaN(n as number) ? "-"
      : (n as number).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  // Numero de semana ISO a partir de "YYYY-MM-DD"
  const isoWeek = (dateStr: string): number => {
    const d = new Date(dateStr + "T12:00:00");
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const startW1 = new Date(jan4);
    startW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    return Math.floor((d.getTime() - startW1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  };

  const arena    = (arenaRecent  ?? []) as Record<string, string | number | null>[];
  const cuarzo   = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  // Agregados por mes y resumen anio
  const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  type MonthAgg = { prod: number; desp: number; kpiN: number; kpiD: number };
  const byMonth: Record<number, MonthAgg> = {};
  let aProd = 0, aDesp = 0;

  for (const r of (arenaYear ?? []) as Record<string, string | number>[]) {
    const prod = (r.produccion_drone    as number) ?? 0;
    const desp = (r.despachos_ton      as number) ?? 0;
    const hrs  = (r.horas_reales       as number) ?? 0;
    const det  = (r.detencion          as number) ?? 0;
    const kpi  = (r.productividad_drone as number) ?? 0;
    aProd += prod;
    aDesp += desp;
    if (!r.fecha) continue;
    const m = parseInt((r.fecha as string).slice(5, 7), 10);
    if (!byMonth[m]) byMonth[m] = { prod: 0, desp: 0, kpiN: 0, kpiD: 0 };
    byMonth[m].prod += prod;
    byMonth[m].desp += desp;
    if (hrs - det > 0) { byMonth[m].kpiN += kpi * (hrs - det); byMonth[m].kpiD += (hrs - det); }
  }

  const monthLines = Object.entries(byMonth)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([m, v]) => {
      const kpiAvg = v.kpiD > 0 ? v.kpiN / v.kpiD : 0;
      return `  ${MESES[Number(m)].padEnd(12)} | prod: ${f(v.prod)} t | desp: ${f(v.desp)} t | kpi prom: ${f(kpiAvg)} t/h`;
    }).join("\n");

  // Ultimo registro arena
  const a0   = arena[0] ?? {};
  const a0wk = a0.fecha ? isoWeek(a0.fecha as string) : "-";

  // Ultimo registro cuarzo
  const c0 = cuarzo[0] ?? {};

  // Historial arena con semana ISO
  const arenaHist = arena.map(r => {
    const wk = r.fecha ? `S${isoWeek(r.fecha as string)}` : "S?";
    return `  [${wk}] ${r.fecha} ${r.hora} | prod: ${f(r.produccion_drone as number)} t | kpi: ${f(r.productividad_drone as number)} t/h | inv: ${f(r.inventario_ton as number)} t | hs.op: ${f(r.horas_reales as number)} h | hs.det: ${f(r.detencion as number)} h`;
  }).join("\n");

  const cuarzoHist = cuarzo.map(r =>
    `  ${r.fecha} ${r.hora} | inv: ${f(r.inventario_ton as number)} t | prod: ${f(r.produccion as number)} t`
  ).join("\n");

  const despHist = despRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "-"} | ${f(r.toneladas as number)} t`
  ).join("\n");

  return [
    "=== VALORES ACTUALES (usar directamente, no calcular) ===",
    "",
    `ULTIMO REGISTRO ARENA - ${a0.fecha ?? "-"} ${a0.hora ?? ""} (semana ISO ${a0wk}):`,
    `  Productividad (kpi) : ${f(a0.productividad_drone as number)} t/h`,
    `  Produccion          : ${f(a0.produccion_drone as number)} ton`,
    `  Inventario arena    : ${f(a0.inventario_ton as number)} ton`,
    `  Horas de operacion  : ${f(a0.horas_reales as number)} h`,
    `  Horas de detencion  : ${f(a0.detencion as number)} h`,
    `  Despachos           : ${f(a0.despachos_ton as number)} ton`,
    "",
    `ULTIMO REGISTRO CUARZO - ${c0.fecha ?? "-"} ${c0.hora ?? ""}:`,
    `  Inventario cuarzo   : ${f(c0.inventario_ton as number)} ton`,
    `  Produccion          : ${f(c0.produccion as number)} ton`,
    "",
    `RESUMEN ANIO ${year}:`,
    `  Produccion acumulada: ${f(aProd)} ton`,
    `  Despachos acumulados: ${f(aDesp)} ton`,
    "",
    `PRODUCCION POR MES - ${year}:`,
    monthLines || "  (sin datos)",
    "",
    "=== HISTORIAL RECIENTE (con semana ISO entre corchetes) ===",
    "",
    "Arena - ultimos 20 registros:",
    arenaHist || "  (sin datos)",
    "",
    "Cuarzo - ultimos 10 registros:",
    cuarzoHist || "  (sin datos)",
    "",
    "Despachos - ultimos 10:",
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
    "Puedes responder preguntas sobre todas las secciones de la aplicacion:",
    "- Dashboard: resumen de KPIs de produccion y productividad",
    "- Control de vuelos (droneos): registro de vuelos del dron, horas operacion y detencion",
    "- Informe: reporte semanal/mensual de productividad de arena y cuarzo",
    "- Inventario: stock actual de arena y cuarzo",
    "- Despachos: movimiento de material hacia clientes o planta",
    "- Cualquier pregunta general sobre la operacion de la planta",
    "",
    "INSTRUCCION PRINCIPAL:",
    "Los datos ya vienen organizados y listos. No inventes, no calcules, no promedies.",
    "",
    "Reglas:",
    "1. Si preguntan por el valor actual o ultimo -> usa VALORES ACTUALES.",
    "2. Si preguntan por una SEMANA ESPECIFICA (ej. semana 25) -> busca en el HISTORIAL RECIENTE los registros marcados [S25] y reporta sus valores. Si no hay registros de esa semana en el historial, di: No tengo registros de la semana XX en el historial disponible.",
    "3. Si preguntan por un MES (ej. junio, mes 6) -> usa PRODUCCION POR MES y reporta los valores de ese mes directamente.",
    "4. Si preguntan por el ANIO -> usa RESUMEN ANIO para produccion/despachos acumulados.",
    "5. NUNCA intentes deducir o calcular semanas a partir de fechas. Si no esta en el historial, no lo tienes.",
    "",
    "Ejemplos de respuesta correcta:",
    "- Cual es la productividad actual? -> La productividad del ultimo registro (fecha, semana ISO X) es X,X t/h.",
    "- Cual es la productividad de la semana 25? -> busca [S25] en el historial -> En la semana 25 el registro del DD/MM muestra X,X t/h.",
    "- Cuanto se produjo en junio? -> En Junio la produccion fue X.XXX,X ton con un kpi promedio de X,X t/h.",
    "- Cuanto se produjo este anio? -> La produccion acumulada del anio es X.XXX,X ton.",
    "",
    "Responde siempre en espaniol. Se breve y directo. Incluye siempre la unidad (ton, t/h, h).",
    "Referencia: objetivo productividad 32 t/h | objetivo inventario arena 7.500 ton",
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
          temperature: 0.1,
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
