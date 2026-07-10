/**
 * POST /api/chat
 *
 * Chatbot de Arena Control.
 * Estrategia: el servidor consulta Supabase y entrega los valores ya listos;
 * el LLM los lee y reporta directamente. Sin calculos en el modelo.
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
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .order("fecha_hora", { ascending: false })
      .limit(20),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion_drone, productividad_drone, despachos_ton, horas_reales, detencion")
      .order("fecha_hora", { ascending: false })
      .limit(10),
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
    n == null || isNaN(n as number) ? "sin dato"
      : (n as number).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  // Numero de semana ISO
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

  // Agregados mensuales arena
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

  const a0   = arena[0]  ?? {};
  const a0wk = a0.fecha  ? isoWeek(a0.fecha as string) : "?";
  const c0   = cuarzo[0] ?? {};
  const c0wk = c0.fecha  ? isoWeek(c0.fecha as string) : "?";

  const arenaHist = arena.map(r => {
    const wk = r.fecha ? `S${isoWeek(r.fecha as string)}` : "S?";
    return `  [${wk}] ${r.fecha} ${r.hora} | prod: ${f(r.produccion_drone as number)} t | kpi: ${f(r.productividad_drone as number)} t/h | inv: ${f(r.inventario_ton as number)} t | hs.op: ${f(r.horas_reales as number)} h | hs.det: ${f(r.detencion as number)} h`;
  }).join("\n");

  const cuarzoHist = cuarzo.map(r => {
    const wk = r.fecha ? `S${isoWeek(r.fecha as string)}` : "S?";
    return `  [${wk}] ${r.fecha} ${r.hora} | inv: ${f(r.inventario_ton as number)} t | prod: ${f(r.produccion_drone as number)} t | kpi: ${f(r.productividad_drone as number)} t/h`;
  }).join("\n");

  const despHist = despRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "sin destino"} | ${f(r.toneladas as number)} t`
  ).join("\n");

  return [
    `=== DATOS EN TIEMPO REAL DE SUPABASE (planta Las Piedras, ${new Date().toLocaleDateString("es-CL")}) ===`,
    "",
    `ULTIMO REGISTRO ARENA | ${a0.fecha ?? "sin fecha"} ${a0.hora ?? ""} | Semana ISO ${a0wk}:`,
    `  Productividad : ${f(a0.productividad_drone as number)} t/h`,
    `  Produccion    : ${f(a0.produccion_drone as number)} ton`,
    `  Inventario    : ${f(a0.inventario_ton as number)} ton`,
    `  Hs. operacion : ${f(a0.horas_reales as number)} h`,
    `  Hs. detencion : ${f(a0.detencion as number)} h`,
    `  Despachos     : ${f(a0.despachos_ton as number)} ton`,
    "",
    `ULTIMO REGISTRO CUARZO | ${c0.fecha ?? "sin fecha"} ${c0.hora ?? ""} | Semana ISO ${c0wk}:`,
    `  Inventario    : ${f(c0.inventario_ton as number)} ton`,
    `  Produccion    : ${f(c0.produccion_drone as number)} ton`,
    `  Productividad : ${f(c0.productividad_drone as number)} t/h`,
    `  Hs. operacion : ${f(c0.horas_reales as number)} h`,
    `  Hs. detencion : ${f(c0.detencion as number)} h`,
    "",
    `RESUMEN ANIO ${year}:`,
    `  Produccion acumulada arena: ${f(aProd)} ton`,
    `  Despachos acumulados arena: ${f(aDesp)} ton`,
    "",
    `PRODUCCION MENSUAL ARENA ${year}:`,
    monthLines || "  (sin datos)",
    "",
    "=== HISTORIAL RECIENTE (semana ISO entre corchetes) ===",
    "",
    "Arena (ultimos 20 registros):",
    arenaHist || "  (sin datos)",
    "",
    "Cuarzo (ultimos 10 registros):",
    cuarzoHist || "  (sin datos)",
    "",
    "Despachos (ultimos 10):",
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
    "FUENTE DE DATOS: Los datos que ves a continuacion provienen DIRECTAMENTE de la base de datos",
    "de produccion de la planta (Supabase), consultada en tiempo real hace instantes.",
    "Son registros reales de droneos y pesajes — no un documento ni texto de ejemplo.",
    "",
    "Puedes responder sobre todas las secciones: Dashboard, Control de vuelos,",
    "Informe semanal, Inventario, Despachos y operacion general de la planta.",
    "",
    "REGLAS (seguir en orden):",
    "1. Valor actual/ultimo -> usa ULTIMO REGISTRO correspondiente.",
    "2. Semana especifica (ej. semana 25) -> busca [S25] en el HISTORIAL RECIENTE y reporta esos valores.",
    "   Si no aparece esa semana, di: No tengo registros de la semana XX en el historial disponible.",
    "3. Mes (ej. junio, mes 6) -> usa PRODUCCION MENSUAL y reporta directo.",
    "4. Anio -> usa RESUMEN ANIO.",
    "5. Nunca deduzcas semanas a partir de fechas. Si no esta en el historial, no lo tienes.",
    "6. Nunca digas que eres un texto plano o que no tienes acceso a datos reales.",
    "   Estos son datos reales de la planta.",
    "",
    "Responde siempre en espanol. Se breve y directo. Incluye siempre la unidad (ton, t/h, h).",
    "Objetivos de referencia: productividad 32 t/h | inventario arena 7.500 ton",
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
