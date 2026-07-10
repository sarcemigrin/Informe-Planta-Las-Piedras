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
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .order("fecha_hora", { ascending: false })
      .limit(5),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(3),
    sb.from("registros_arena")
      .select("produccion_drone, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: false })
      .limit(90),
    Promise.resolve(
      sb.from("despachos")
        .select("fecha, hora, destino, toneladas")
        .order("fecha", { ascending: false })
        .limit(5)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const f = (n: number | null | undefined, dec = 1) =>
    n == null || isNaN(n as number) ? "–"
      : (n as number).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const arena   = (arenaRecent  ?? []) as Record<string, string | number | null>[];
  const cuarzo  = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  // Resumen año
  let aProd = 0, aDesp = 0;
  for (const r of (arenaYear ?? []) as Record<string, number>[]) {
    aProd += r.produccion_drone ?? 0;
    aDesp += r.despachos_ton   ?? 0;
  }

  // Último registro arena
  const a0 = arena[0] ?? {};

  // Último registro cuarzo
  const c0 = cuarzo[0] ?? {};

  // Historial arena (últimos 5)
  const arenaHist = arena.map(r =>
    `  ${r.fecha} ${r.hora} | prod: ${f(r.produccion_drone as number)} t | kpi: ${f(r.productividad_drone as number)} t/h | inv: ${f(r.inventario_ton as number)} t | hs.op: ${f(r.horas_reales as number)} h | hs.det: ${f(r.detencion as number)} h`
  ).join("\n");

  const cuarzoHist = cuarzo.map(r =>
    `  ${r.fecha} ${r.hora} | inv: ${f(r.inventario_ton as number)} t | prod: ${f(r.produccion as number)} t`
  ).join("\n");

  const despHist = despRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "–"} | ${f(r.toneladas as number)} t`
  ).join("\n");

  return `=== VALORES ACTUALES (usar directamente, no calcular) ===

ÚLTIMO REGISTRO ARENA — ${a0.fecha ?? "–"} ${a0.hora ?? ""}:
  Productividad (kpi) : ${f(a0.productividad_drone as number)} t/h
  Producción          : ${f(a0.produccion_drone as number)} ton
  Inventario arena    : ${f(a0.inventario_ton as number)} ton
  Horas de operación  : ${f(a0.horas_reales as number)} h
  Horas de detención  : ${f(a0.detencion as number)} h
  Despachos           : ${f(a0.despachos_ton as number)} ton

ÚLTIMO REGISTRO CUARZO — ${c0.fecha ?? "–"} ${c0.hora ?? ""}:
  Inventario cuarzo   : ${f(c0.inventario_ton as number)} ton
  Producción          : ${f(c0.produccion as number)} ton

RESUMEN AÑO ${year}:
  Producción acumulada: ${f(aProd)} ton
  Despachos acumulados: ${f(aDesp)} ton

=== HISTORIAL RECIENTE (referencia) ===

Arena — últimos 5 registros:
${arenaHist || "  (sin datos)"}

Cuarzo — últimos 3 registros:
${cuarzoHist || "  (sin datos)"}

Despachos — últimos 5:
${despHist || "  (sin datos)"}`.trim();
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
  return `Eres el asistente de Arena Control de Migrin, planta Las Piedras.
Puedes responder preguntas sobre todas las secciones de la aplicación:
- Dashboard: resumen de KPIs de producción y productividad
- Control de vuelos (droneos): registro de vuelos del dron, horas operación y detención
- Informe: reporte semanal/mensual de productividad de arena y cuarzo
- Inventario: stock actual de arena y cuarzo
- Despachos: movimiento de material hacia clientes o planta
- Cualquier pregunta general sobre la operación de la planta

INSTRUCCIÓN PRINCIPAL: Los valores en "VALORES ACTUALES" ya están calculados y listos.
Cuando el usuario pregunte por productividad, producción, inventario u horas, responde DIRECTAMENTE con el número que aparece ahí. No sumes, no promedies, no calcules nada.

Ejemplos de respuesta correcta:
- "¿Cuál es la productividad?" → "La productividad del último registro (${new Date().toLocaleDateString("es-CL")}) es X,X t/h."
- "¿Cuál es el inventario de arena?" → "El inventario actual de arena es X.XXX,X ton."

Responde siempre en español. Sé breve y directo. Incluye siempre la unidad (ton, t/h, h).
Referencia: objetivo productividad 32 t/h | objetivo inventario arena 7.500 ton

${dataContext}`;
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
          max_tokens:  256,
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
