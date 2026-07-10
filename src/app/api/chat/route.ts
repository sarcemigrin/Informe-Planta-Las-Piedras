/**
 * POST /api/chat
 *
 * Chatbot de Arena Control — responde preguntas en lenguaje natural
 * sobre los datos de producción (arena, cuarzo, despachos).
 *
 * Usa Claude con streaming SSE para respuestas en tiempo real.
 * Incluye contexto fresco de Supabase en cada petición.
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions }      from "@/lib/authOptions";
import { requireJson }      from "@/lib/apiGuard";
import { createClient }     from "@supabase/supabase-js";
import Anthropic            from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// ── Obtener contexto de datos frescos ───────────────────────────────────────

async function getDataContext(): Promise<string> {
  const sb = getSupabase();
  const hoy = new Date();
  const year = hoy.getFullYear();
  const yearStart = `${year}-01-01`;

  const [
    { data: arenaRecent },
    { data: arenaYear },
    { data: cuarzoRecent },
    { data: despachos },
  ] = await Promise.all([
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, productividad_pesometro, produccion_pesometro, inventario_ton, horas_reales, detencion, despachos_ton, cantidad_despachos, diferencia_pesometro, diferencia_horometro")
      .order("fecha_hora", { ascending: false })
      .limit(20),
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, despachos_ton")
      .gte("fecha", yearStart)
      .order("fecha_hora", { ascending: true }),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(10),
    sb.from("despachos")
      .select("fecha, hora, destino, toneladas, camiones")
      .order("fecha", { ascending: false })
      .limit(30)
      .catch(() => ({ data: [] })),
  ]);

  // Calcular resumen del año arena
  let totalProdAno = 0, totalDespachoAno = 0, countAno = 0;
  if (arenaYear) {
    for (const r of arenaYear as Record<string, number | string>[]) {
      totalProdAno   += (r.produccion_drone as number) ?? 0;
      totalDespachoAno += (r.despachos_ton as number) ?? 0;
      countAno++;
    }
  }

  const fmt1 = (n: number | null | undefined) =>
    n == null ? "–" : n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const arenaRows = (arenaRecent ?? []) as Record<string, string | number | null>[];
  const cuarzoRows = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despachoRows = (despachos ?? []) as Record<string, string | number | null>[];

  const arenaTable = arenaRows
    .map(r =>
      `  ${r.fecha} ${r.hora} | prod_drone: ${fmt1(r.produccion_drone as number)} ton | kpi_drone: ${fmt1(r.productividad_drone as number)} t/h | prod_peso: ${fmt1(r.produccion_pesometro as number)} ton | kpi_peso: ${fmt1(r.productividad_pesometro as number)} t/h | inventario: ${fmt1(r.inventario_ton as number)} ton | horas: ${fmt1(r.horas_reales as number)} h | detencion: ${fmt1(r.detencion as number)} h | despachos: ${fmt1(r.despachos_ton as number)} ton (${r.cantidad_despachos ?? 0} viajes)`
    )
    .join("\n");

  const cuarzoTable = cuarzoRows
    .map(r =>
      `  ${r.fecha} ${r.hora} | inventario: ${fmt1(r.inventario_ton as number)} ton | produccion: ${fmt1(r.produccion as number)} ton | despachos: ${fmt1(r.despachos as number)} ton`
    )
    .join("\n");

  const despachoTable = despachoRows
    .map(r =>
      `  ${r.fecha} ${r.hora} | destino: ${r.destino ?? "–"} | toneladas: ${fmt1(r.toneladas as number)} | camiones: ${r.camiones ?? "–"}`
    )
    .join("\n");

  return `
## CONTEXTO DE DATOS — ${hoy.toLocaleDateString("es-CL")}

### Arena — últimos 20 registros (más reciente primero):
${arenaTable || "  (sin datos)"}

### Arena — resumen año ${year}:
  Total producción: ${fmt1(totalProdAno)} ton
  Total despachos:  ${fmt1(totalDespachoAno)} ton
  Cubicaciones:     ${countAno}

### Cuarzo — últimos 10 registros:
${cuarzoTable || "  (sin datos)"}

### Despachos — últimos 30 registros:
${despachoTable || "  (sin datos)"}
`.trim();
}

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(dataContext: string): string {
  return `Eres el asistente de Arena Control de Migrin. Respondes preguntas sobre datos de producción de arena y cuarzo en lenguaje natural, en español.

## Tu rol:
- Analizar y explicar los datos de producción que se te proporcionan
- Responder preguntas sobre tendencias, comparaciones, totales y rendimiento
- Ser directo y conciso; usa números concretos
- Si no tienes datos suficientes para responder con precisión, dílo claramente

## Glosario de campos:
- produccion_drone (ton): toneladas medidas por el drone en esa cubicación
- productividad_drone (t/h): eficiencia del drone (produccion/horas)
- produccion_pesometro (ton): toneladas según pesómetro
- productividad_pesometro (t/h): eficiencia según pesómetro
- inventario_ton: stock de arena disponible en toneladas
- horas_reales / diferencia_horometro: horas productivas trabajadas
- detencion: horas de parada
- despachos_ton: toneladas despachadas en el período
- cantidad_despachos: número de viajes de despacho
- diferencia_pesometro: diferencia % entre drone y pesómetro (positivo = pesómetro mayor)

## Umbrales de referencia:
- Productividad objetivo: 32 t/h
- Inventario mínimo: 6.500 ton (alerta), objetivo: 7.500 ton

## Formato de respuesta:
- Responde en español
- Usa formato Markdown sencillo (negritas, listas cortas si aplica)
- No hagas respuestas largas innecesarias
- Para comparaciones usa porcentajes o diferencias absolutas

---

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

  const body = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages requerido." }, { status: 400 });
  }

  // Limitar historial a últimas 20 interacciones para no exceder tokens
  const messages = body.messages.slice(-20);

  // Obtener contexto de datos (en paralelo con la validación)
  let dataContext = "";
  try {
    dataContext = await getDataContext();
  } catch (e) {
    console.warn("[chat] No se pudo obtener contexto de datos:", e);
    dataContext = "(No se pudieron cargar los datos en este momento)";
  }

  // Streaming con Claude
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await anthropic.messages.stream({
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system:     buildSystemPrompt(dataContext),
          messages,
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (e) {
        console.error("[chat] Anthropic error:", e);
        controller.enqueue(encoder.encode("\n\n[Error al generar respuesta]"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
