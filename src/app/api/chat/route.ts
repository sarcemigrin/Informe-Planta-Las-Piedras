/**
 * POST /api/chat
 *
 * Chatbot de Arena Control — responde preguntas en lenguaje natural
 * sobre los datos de producción (arena, cuarzo, despachos).
 *
 * Usa Groq (Llama 3.1 — free tier: 14.400 req/día) con streaming.
 * Métricas semanales con la misma fórmula que el informe:
 *   KPI = sum(produccion_drone) / sum(horas_reales - detencion)
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

// ── Semana ISO (lunes=1) ─────────────────────────────────────────────────────
function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ── Contexto de datos frescos desde Supabase ────────────────────────────────

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  // Últimas 3 semanas para calcular semana actual y anterior
  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const threeWeeksStr = threeWeeksAgo.toISOString().split("T")[0];

  const [
    { data: arenaRecent },
    { data: arenaWeekly },
    { data: arenaYear },
    { data: cuarzoRecent },
    despachoResult,
  ] = await Promise.all([
    // 8 registros más recientes (para inventario actual y tabla)
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .order("fecha_hora", { ascending: false })
      .limit(8),
    // Últimas 3 semanas para métricas semanales
    sb.from("registros_arena")
      .select("fecha, produccion_drone, horas_reales, detencion")
      .gte("fecha", threeWeeksStr)
      .order("fecha_hora", { ascending: true }),
    // Resumen año (max 90 registros)
    sb.from("registros_arena")
      .select("fecha, produccion_drone, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: false })
      .limit(90),
    // Cuarzo reciente
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(5),
    // Despachos recientes
    Promise.resolve(
      sb.from("despachos")
        .select("fecha, hora, destino, toneladas")
        .order("fecha", { ascending: false })
        .limit(8)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const fmt = (n: number | null | undefined, dec = 1) =>
    n == null || isNaN(n as number)
      ? "–"
      : (n as number).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  // ── Métricas semanales ─────────────────────────────────────────────────────
  // Agrupa por semana ISO; calcula KPI = sum(prod) / sum(horas_maquina)
  // donde horas_maquina = horas_reales - detencion (= diferencia_horometro)
  type WeekAgg = { prod: number; horasReal: number; det: number; count: number; fechas: string[] };
  const weekMap: Record<number, WeekAgg> = {};

  for (const r of (arenaWeekly ?? []) as Record<string, string | number | null>[]) {
    const w = isoWeek(r.fecha as string);
    if (!weekMap[w]) weekMap[w] = { prod: 0, horasReal: 0, det: 0, count: 0, fechas: [] };
    weekMap[w].prod      += (r.produccion_drone as number) ?? 0;
    weekMap[w].horasReal += (r.horas_reales     as number) ?? 0;
    weekMap[w].det       += (r.detencion        as number) ?? 0;
    weekMap[w].count     += 1;
    weekMap[w].fechas.push(r.fecha as string);
  }

  const semanas = Object.keys(weekMap).map(Number).sort((a, b) => b - a);
  const semActual = semanas[0];
  const semAnterior = semanas[1];

  function semLabel(w: number | undefined, agg: WeekAgg | undefined): string {
    if (!w || !agg) return "  (sin datos)";
    const horasMaq = agg.horasReal - agg.det;
    const kpi      = horasMaq > 0 ? agg.prod / horasMaq : 0;
    const fechaMin = agg.fechas.sort()[0];
    const fechaMax = agg.fechas.sort()[agg.fechas.length - 1];
    return [
      `  Semana ISO ${w} (${fechaMin} → ${fechaMax}) — ${agg.count} cubicaciones`,
      `  Producción total : ${fmt(agg.prod)} ton`,
      `  Productividad   : ${fmt(kpi)} t/h  [sum(prod)/sum(hs.máquina)]`,
      `  Horas operación: ${fmt(agg.horasReal)} h`,
      `  Horas detención: ${fmt(agg.det)} h`,
      `  Horas máquina  : ${fmt(horasMaq)} h`,
    ].join("\n");
  }

  // ── Resumen año ──────────────────────────────────────────────────────────────
  let totalProd = 0, totalDesp = 0, countYear = 0;
  for (const r of (arenaYear ?? []) as Record<string, number>[]) {
    totalProd  += r.produccion_drone ?? 0;
    totalDesp  += r.despachos_ton   ?? 0;
    countYear++;
  }

  // ── Inventario actual ────────────────────────────────────────────────────────
  const arenaRows    = (arenaRecent  ?? []) as Record<string, string | number | null>[];
  const cuarzoRows   = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despachoRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  const invArena  = arenaRows[0]?.inventario_ton;
  const invArenaF = arenaRows[0] ? `${arenaRows[0].fecha} ${arenaRows[0].hora}` : "";
  const invCuarzo  = cuarzoRows[0]?.inventario_ton;
  const invCuarzoF = cuarzoRows[0] ? `${cuarzoRows[0].fecha} ${cuarzoRows[0].hora}` : "";

  // ── Tabla registros recientes ────────────────────────────────────────────────
  const arenaTable = arenaRows.map(r =>
    `  ${r.fecha} ${r.hora} | prod: ${fmt(r.produccion_drone as number)} t | kpi: ${fmt(r.productividad_drone as number)} t/h | inv: ${fmt(r.inventario_ton as number)} t | hr: ${fmt(r.horas_reales as number)} h | det: ${fmt(r.detencion as number)} h`
  ).join("\n");

  const cuarzoTable = cuarzoRows.map(r =>
    `  ${r.fecha} ${r.hora} | inv: ${fmt(r.inventario_ton as number)} t | prod: ${fmt(r.produccion as number)} t | desp: ${fmt(r.despachos as number)} t`
  ).join("\n");

  const despachoTable = despachoRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "–"} | ${fmt(r.toneladas as number)} t`
  ).join("\n");

  const periodLabel = countYear >= 90
    ? `últimos 90 registros`
    : `año ${year} (${countYear} cubicaciones)`;

  return `DATOS (${new Date().toLocaleDateString("es-CL")}):

INVENTARIO ACTUAL:
  Arena : ${fmt(invArena)} ton  (al ${invArenaF})
  Cuarzo: ${fmt(invCuarzo)} ton  (al ${invCuarzoF})

ÚLTIMA SEMANA (sem. ISO ${semActual ?? "–"}):
${semLabel(semActual, semActual ? weekMap[semActual] : undefined)}

SEMANA ANTERIOR (sem. ISO ${semAnterior ?? "–"}):
${semLabel(semAnterior, semAnterior ? weekMap[semAnterior] : undefined)}

ARENA — resumen ${periodLabel}:
  Producción acum: ${fmt(totalProd)} ton | Despachos acum: ${fmt(totalDesp)} ton

ARENA — 8 registros recientes:
${arenaTable || "  (sin datos)"}

CUARZO — 5 registros recientes:
${cuarzoTable || "  (sin datos)"}

DESPACHOS — 8 más recientes:
${despachoTable || "  (sin datos)"}`.trim();
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

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(dataContext: string): string {
  return `Eres el asistente de Arena Control de Migrin. Tu único rol es responder preguntas sobre los datos de producción de arena y cuarzo que se te proporcionan.

REGLAS:
- Solo respondes preguntas relacionadas con los datos de producción, inventario, despachos y KPIs
- Si te preguntan algo que no tiene que ver con los datos de la app, responde: "Solo puedo ayudarte con preguntas sobre los datos de producción de Arena Control."
- Responde siempre en español, de forma directa y concisa
- Usa los datos concretos del contexto. Las métricas semanales ya están pre-calculadas: úsalas directamente sin re-calcular
- Si no tienes suficientes datos para responder, dilo claramente

FÓRMULAS (para tu referencia):
- Productividad semanal = sum(producción) / sum(horas_máquina)  donde horas_máquina = horas_reales - detencion
- Objetivo productividad: 32 t/h | Objetivo inventario arena: 7.500 ton

GLOSARIO:
- produccion_drone: toneladas producidas medidas por el drone
- productividad: eficiencia en t/h (sobre horas de máquina/horómetro)
- inventario_ton: stock disponible en toneladas
- horas_reales: tiempo transcurrido entre cubicaciones
- detencion: horas de parada (horas_reales - horas_máquina)
- horas_máquina: horas efectivas de operación del horómetro

${dataContext}`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

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

  const messages = body.messages.slice(-20);

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
    ...messages.map(m => ({
      role:    m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      try {
        const completion = await groq.chat.completions.create({
          model:       "llama-3.1-8b-instant",
          messages:    groqMessages,
          stream:      true,
          max_tokens:  1024,
          temperature: 0.2,
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
