/**
 * POST /api/chat
 *
 * Chatbot de Arena Control — responde preguntas en lenguaje natural.
 * Usa Groq llama-3.3-70b-versatile (free tier: 1.000 req/día).
 *
 * Criterio semana: igual que vista Diario — distribuye producción,
 * horas y detención proporcionalmente entre los días del período,
 * luego agrupa por semana ISO.
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

// ── Semana ISO ───────────────────────────────────────────────────────────────
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ── Distribución diaria (igual que calcularDiario) ───────────────────────────
// Para cada período entre droneos, reparte proporcionalmente entre los días.
// weekMap[isoWeek] acumula: prod, horasReales, detencion
type WeekAgg = {
  prod: number; horasReal: number; det: number;
  fechaMin: string; fechaMax: string;
};

function distribuirEnSemanas(
  records: { fecha: string; produccion_drone: number; horas_reales: number; detencion: number }[]
): Record<number, WeekAgg> {
  const weekMap: Record<number, WeekAgg> = {};

  const add = (date: Date, prod: number, hr: number, det: number) => {
    const w = isoWeek(date);
    const ds = date.toISOString().split("T")[0];
    if (!weekMap[w]) weekMap[w] = { prod: 0, horasReal: 0, det: 0, fechaMin: ds, fechaMax: ds };
    weekMap[w].prod      += prod;
    weekMap[w].horasReal += hr;
    weekMap[w].det       += det;
    if (ds < weekMap[w].fechaMin) weekMap[w].fechaMin = ds;
    if (ds > weekMap[w].fechaMax) weekMap[w].fechaMax = ds;
  };

  // records deben estar ordenados ascendente
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];

    const prevDate = new Date(prev.fecha + "T12:00:00");
    const currDate = new Date(curr.fecha + "T12:00:00");
    const diasPeriodo = Math.max(
      1,
      Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    const prodDia = curr.produccion_drone / diasPeriodo;
    const hrDia   = curr.horas_reales    / diasPeriodo;
    const detDia  = curr.detencion       / diasPeriodo;

    // Distribuir día a día (día 1 = día siguiente al droneo anterior;
    // día diasPeriodo = día del droneo actual)
    for (let d = 1; d <= diasPeriodo; d++) {
      const dia = new Date(prevDate);
      dia.setDate(dia.getDate() + d);
      add(dia, prodDia, hrDia, detDia);
    }
  }

  return weekMap;
}

// ── Contexto de datos ────────────────────────────────────────────────────────

async function getDataContext(): Promise<string> {
  const sb   = getSupabase();
  const year = new Date().getFullYear();

  // Necesitamos ~20 registros para cubrir bien las últimas 3 semanas con distribución
  const [
    { data: arenaAll },
    { data: cuarzoRecent },
    { data: arenaYear },
    despachoResult,
  ] = await Promise.all([
    sb.from("registros_arena")
      .select("fecha, hora, produccion_drone, productividad_drone, inventario_ton, horas_reales, detencion, despachos_ton")
      .order("fecha_hora", { ascending: false })
      .limit(20),
    sb.from("registros_cuarzo")
      .select("fecha, hora, inventario_ton, produccion, despachos")
      .order("fecha_hora", { ascending: false })
      .limit(5),
    sb.from("registros_arena")
      .select("fecha, produccion_drone, despachos_ton")
      .gte("fecha", `${year}-01-01`)
      .order("fecha_hora", { ascending: false })
      .limit(90),
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

  // ── Distribución diaria por semana ─────────────────────────────────────────
  const arenaAll_typed = ([...(arenaAll ?? [])] as {
    fecha: string; produccion_drone: number; horas_reales: number; detencion: number;
  }[]).reverse(); // ascendente

  const weekMap = distribuirEnSemanas(arenaAll_typed);
  const semanas = Object.keys(weekMap).map(Number).sort((a, b) => b - a);
  const semActual   = semanas[0];
  const semAnterior = semanas[1];

  function semStr(w: number | undefined): string {
    if (!w || !weekMap[w]) return "  (sin datos)";
    const agg = weekMap[w];
    const horasMaq = Math.max(0, agg.horasReal - agg.det);
    const kpi      = horasMaq > 0 ? agg.prod / horasMaq : 0;
    return [
      `  Período distribuido: ${agg.fechaMin} → ${agg.fechaMax}`,
      `  Producción : ${fmt(agg.prod)} ton`,
      `  KPI (t/h)  : ${fmt(kpi)}  [prod / horas_máquina]`,
      `  Hs operac. : ${fmt(agg.horasReal)} h`,
      `  Hs detenc. : ${fmt(agg.det)} h`,
      `  Hs máquina : ${fmt(horasMaq)} h`,
    ].join("\n");
  }

  // ── Inventario actual ─────────────────────────────────────────────────────
  const arenaRows    = (arenaAll  ?? []) as Record<string, string | number | null>[];
  const cuarzoRows   = (cuarzoRecent ?? []) as Record<string, string | number | null>[];
  const despachoRows = (despachoResult.data ?? []) as Record<string, string | number | null>[];

  const invArena  = arenaRows[0];
  const invCuarzo = cuarzoRows[0];

  // ── Resumen año ───────────────────────────────────────────────────────────
  let totalProd = 0, totalDesp = 0, countYear = 0;
  for (const r of (arenaYear ?? []) as Record<string, number>[]) {
    totalProd  += r.produccion_drone ?? 0;
    totalDesp  += r.despachos_ton   ?? 0;
    countYear++;
  }
  const periodLabel = countYear >= 90 ? "últimos 90 registros" : `año ${year}`;

  // ── Tablas de referencia ──────────────────────────────────────────────────
  const arenaTable = arenaRows.slice(0, 8).map(r =>
    `  ${r.fecha} ${r.hora} | prod: ${fmt(r.produccion_drone as number)} t | kpi: ${fmt(r.productividad_drone as number)} t/h | inv: ${fmt(r.inventario_ton as number)} t | hr: ${fmt(r.horas_reales as number)} h | det: ${fmt(r.detencion as number)} h`
  ).join("\n");

  const cuarzoTable = cuarzoRows.map(r =>
    `  ${r.fecha} ${r.hora} | inv: ${fmt(r.inventario_ton as number)} t | prod: ${fmt(r.produccion as number)} t | desp: ${fmt(r.despachos as number)} t`
  ).join("\n");

  const despachoTable = despachoRows.map(r =>
    `  ${r.fecha} ${r.hora} | ${r.destino ?? "–"} | ${fmt(r.toneladas as number)} t`
  ).join("\n");

  return `DATOS PRE-CALCULADOS (${new Date().toLocaleDateString("es-CL")}):
NOTA: las métricas semanales usan distribución diaria proporcional (mismo criterio que vista Diario).
NO re-calcules estos valores — usa los números exactos que se muestran aquí.

══ INVENTARIO ACTUAL ══
  Arena : ${fmt(invArena?.inventario_ton as number)} ton  (cubicación del ${invArena?.fecha} ${invArena?.hora})
  Cuarzo: ${fmt(invCuarzo?.inventario_ton as number)} ton  (cubicación del ${invCuarzo?.fecha} ${invCuarzo?.hora})

══ ÚLTIMA SEMANA ISO ${semActual ?? "–"} ══
${semStr(semActual)}

══ SEMANA ANTERIOR ISO ${semAnterior ?? "–"} ══
${semStr(semAnterior)}

══ RESUMEN ${periodLabel.toUpperCase()} ══
  Producción acumulada: ${fmt(totalProd)} ton
  Despachos acumulados: ${fmt(totalDesp)} ton
  Cubicaciones: ${countYear}

══ REGISTROS RECIENTES (referencia) ══
${arenaTable || "  (sin datos)"}

══ CUARZO RECIENTE ══
${cuarzoTable || "  (sin datos)"}

══ DESPACHOS RECIENTES ══
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

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(dataContext: string): string {
  return `Eres el asistente de Arena Control de Migrin. Respondes ÚNICAMENTE preguntas sobre los datos de producción que se te entregan a continuación.

INSTRUCCIONES ESTRICTAS:
1. Los valores en "DATOS PRE-CALCULADOS" son los correctos. NO los recalcules ni los cuestiones.
2. Cuando te pregunten por la última semana, usa EXACTAMENTE los números de "ÚLTIMA SEMANA ISO".
3. Cuando te pregunten por inventario actual, usa EXACTAMENTE los números de "INVENTARIO ACTUAL".
4. Si te preguntan algo fuera del contexto de producción, responde: "Solo puedo ayudarte con datos de producción de Arena Control."
5. Responde en español, directo y conciso. Incluye siempre la unidad (ton, t/h, h).

GLOSARIO:
- KPI / productividad: toneladas por hora de máquina (t/h). Objetivo: 32 t/h
- Inventario objetivo arena: 7.500 ton
- Horas máquina = horas_reales - detención (horas del horómetro)
- Distribución diaria: la producción entre droneos se reparte entre los días del período

${dataContext}`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
          model:       "llama-3.3-70b-versatile",
          messages:    groqMessages,
          stream:      true,
          max_tokens:  512,
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
