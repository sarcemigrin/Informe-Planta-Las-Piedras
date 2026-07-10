/**
 * POST /api/chat
 *
 * Chatbot de Arena Control — responde preguntas en lenguaje natural
 * sobre los datos de producción (arena, cuarzo, despachos).
 *
 * Usa Groq (Llama 3.1 — free tier: 14.400 req/día) con streaming.
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

// ── Contexto de datos frescos desde Supabase ────────────────────────────────

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  const [
    { data: arenaRecent },
    { data: arenaYear },
    { data: cuarzoRecent },
    despachoResult,
  ] = await Promise.all([
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .order("fecha_hora", { ascending: false })
      .limit(8),
    sb.from("registros_arena")
      .select("fecha, produccion_drone, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: false })
      .limit(90),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(5),
    Promise.resolve(
      sb.from("despachos")
        .select("fecha, hora, destino, toneladas")
        .order("fecha", { ascending: false })
        .limit(8)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const fmt = (n: number | null | undefined) =>
    n == null ? "\u2013" : n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let totalProd = 0, totalDesp = 0, count = 0;
  for (const r of (arenaYear ?? []) as Record<string, number>[]) {
    totalProd += r.produccion_drone ?? 0;
    totalDesp += r.despachos_ton   ?? 0;
    count++;
  }

  const arenaRows    = (arenaRecent ?? []) as Record<string, string | number | null>[];
  const cuarzoRows   = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despachoRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  const arenaTable = arenaRows.map(r =>
    `  ${r.fecha} ${r.hora} | prod: ${fmt(r.produccion_drone as number)} t | kpi: ${fmt(r.productividad_drone as number)} t/h | inv: ${fmt(r.inventario_ton as number)} t | hr: ${fmt(r.horas_reales as number)} h | det: ${fmt(r.detencion as number)} h | desp: ${fmt(r.despachos_ton as number)} t`
  ).join("\n");

  const cuarzoTable = cuarzoRows.map(r =>
    `  ${r.fecha} ${r.hora} | inv: ${fmt(r.inventario_ton as number)} t | prod: ${fmt(r.produccion as number)} t | desp: ${fmt(r.despachos as number)} t`
  ).join("\n");

  const despachoTable = despachoRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "\u2013"} | ${fmt(r.toneladas as number)} t`
  ).join("\n");

  const periodLabel = count >= 90
    ? `\u00FAltimos 90 registros (aprox. 90 d\u00EDas)`
    : `a\u00F1o ${year} (${count} cubicaciones)`;

  return `DATOS (${new Date().toLocaleDateString("es-CL")}):

ARENA \u2014 8 registros recientes:
${arenaTable || "  (sin datos)"}

ARENA \u2014 resumen ${periodLabel}:
  Producci\u00F3n acum: ${fmt(totalProd)} ton | Despachos acum: ${fmt(totalDesp)} ton

CUARZO \u2014 5 registros recientes:
${cuarzoTable || "  (sin datos)"}

DESPACHOS \u2014 8 m\u00E1s recientes:
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
  return `Eres el asistente de Arena Control de Migrin. Tu \u00FAnico rol es responder preguntas sobre los datos de producci\u00F3n de arena y cuarzo que se te proporcionan.

REGLAS:
- Solo respondes preguntas relacionadas con los datos de producci\u00F3n, inventario, despachos y KPIs
- Si te preguntan algo que no tiene que ver con los datos de la app, responde: "Solo puedo ayudarte con preguntas sobre los datos de producci\u00F3n de Arena Control."
- Responde siempre en espa\u00F1ol, de forma directa y concisa
- Usa los datos concretos que tienes para responder con n\u00FAmeros reales
- Si no tienes suficientes datos para responder, dilo claramente

GLOSARIO:
- produccion_drone: toneladas medidas por el drone
- productividad_drone (t/h): eficiencia del drone
- produccion_pesometro: toneladas seg\u00FAn pes\u00F3metro
- productividad_pesometro (t/h): eficiencia seg\u00FAn pes\u00F3metro
- inventario_ton: stock disponible en toneladas
- horas_reales: horas productivas trabajadas
- detencion: horas de parada
- despachos_ton: toneladas despachadas
- Productividad objetivo: 32 t/h | Inventario objetivo: 7.500 ton

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

  // Formato OpenAI-compatible: system + historial + mensaje actual
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
          model:      "llama-3.1-8b-instant",
          messages:   groqMessages,
          stream:     true,
          max_tokens: 1024,
          temperature: 0.3,
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
