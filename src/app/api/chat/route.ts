/**
 * POST /api/chat
 *
 * Chatbot de Arena Control — responde preguntas en lenguaje natural
 * sobre los datos de producción (arena, cuarzo, despachos).
 *
 * Usa Google Gemini Flash (gratuito) con streaming SSE.
 */

import { NextResponse }          from "next/server";
import { getServerSession }      from "next-auth/next";
import { authOptions }           from "@/lib/authOptions";
import { requireJson }           from "@/lib/apiGuard";
import { createClient }          from "@supabase/supabase-js";
import { GoogleGenerativeAI }    from "@google/generative-ai";

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
      .select("fecha, hora, produccion_drone, productividad_drone, productividad_pesometro, produccion_pesometro, inventario_ton, horas_reales, detencion, despachos_ton, cantidad_despachos")
      .order("fecha_hora", { ascending: false })
      .limit(20),
    sb.from("registros_arena")
      .select("fecha, produccion_drone, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: true }),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(10),
    Promise.resolve(
      sb.from("despachos")
        .select("fecha, hora, destino, toneladas, camiones")
        .order("fecha", { ascending: false })
        .limit(20)
    ).catch(() => ({ data: [] as Record<string, string | number | null>[] })),
  ]);

  const fmt = (n: number | null | undefined) =>
    n == null ? "–" : n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Resumen año
  let totalProd = 0, totalDesp = 0, count = 0;
  for (const r of (arenaYear ?? []) as Record<string, number>[] ) {
    totalProd += r.produccion_drone ?? 0;
    totalDesp += r.despachos_ton   ?? 0;
    count++;
  }

  const arenaRows = (arenaRecent ?? []) as Record<string, string | number | null>[];
  const cuarzoRows = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despachoRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  const arenaTable = arenaRows.map(r =>
    `  ${r.fecha} ${r.hora} | prod_drone: ${fmt(r.produccion_drone as number)} ton | kpi_drone: ${fmt(r.productividad_drone as number)} t/h | prod_peso: ${fmt(r.produccion_pesometro as number)} ton | kpi_peso: ${fmt(r.productividad_pesometro as number)} t/h | inventario: ${fmt(r.inventario_ton as number)} ton | horas: ${fmt(r.horas_reales as number)} h | detencion: ${fmt(r.detencion as number)} h | despachos: ${fmt(r.despachos_ton as number)} ton (${r.cantidad_despachos ?? 0} viajes)`
  ).join("\n");

  const cuarzoTable = cuarzoRows.map(r =>
    `  ${r.fecha} ${r.hora} | inventario: ${fmt(r.inventario_ton as number)} ton | produccion: ${fmt(r.produccion as number)} ton | despachos: ${fmt(r.despachos as number)} ton`
  ).join("\n");

  const despachoTable = despachoRows.map(r =>
    `  ${r.fecha} ${r.hora} | destino: ${r.destino ?? "–"} | toneladas: ${fmt(r.toneladas as number)} | camiones: ${r.camiones ?? "–"}`
  ).join("\n");

  return `
DATOS ACTUALES (${new Date().toLocaleDateString("es-CL")}):

ARENA — últimos 20 registros (más reciente primero):
${arenaTable || "  (sin datos)"}

ARENA — resumen año ${year}:
  Total producción: ${fmt(totalProd)} ton | Total despachos: ${fmt(totalDesp)} ton | Cubicaciones: ${count}

CUARZO — últimos 10 registros:
${cuarzoTable || "  (sin datos)"}

DESPACHOS — últimos 20 registros:
${despachoTable || "  (sin datos)"}
`.trim();
}

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(dataContext: string): string {
  return `Eres el asistente de Arena Control de Migrin. Tu único rol es responder preguntas sobre los datos de producción de arena y cuarzo que se te proporcionan.

REGLAS:
- Solo respondes preguntas relacionadas con los datos de producción, inventario, despachos y KPIs
- Si te preguntan algo que no tiene que ver con los datos de la app, responde: "Solo puedo ayudarte con preguntas sobre los datos de producción de Arena Control."
- Responde siempre en español, de forma directa y concisa
- Usa los datos concretos que tienes para responder con números reales
- Si no tienes suficientes datos para responder, dilo claramente

GLOSARIO:
- produccion_drone: toneladas medidas por el drone
- productividad_drone (t/h): eficiencia del drone
- produccion_pesometro: toneladas según pesómetro
- productividad_pesometro (t/h): eficiencia según pesómetro
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

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY no configurada." }, { status: 503 });
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
    dataContext = await getDataContext();
  } catch (e) {
    console.warn("[chat] No se pudo obtener contexto:", e);
    dataContext = "(No se pudieron cargar los datos en este momento)";
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: buildSystemPrompt(dataContext),
  });

  // Convertir historial al formato de Gemini (role: "user" | "model")
  const history = messages.slice(0, -1).map(m => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages[messages.length - 1].content;

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      try {
        const chat   = model.startChat({ history });
        const result = await chat.sendMessageStream(lastMessage);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[chat] Gemini error:", msg);
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
