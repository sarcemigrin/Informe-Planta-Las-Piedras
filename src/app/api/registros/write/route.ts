/**
 * POST /api/registros/write
 *
 * Punto único de escritura para registros_arena, registros_cuarzo, despachos
 * e historial_cambios — reemplaza los inserts/updates directos que hacía el
 * navegador con la anon key (bloqueados solo por la interfaz, no por RLS real).
 *
 * Requiere sesión admin. Usa service role. El cliente NUNCA elige libremente
 * columnas de conflicto ni filtros de update arbitrarios — todo lo sensible
 * (onConflict de despachos, actualización por id) queda fijo en el servidor.
 *
 * body:
 *   { table: "registros_arena" | "registros_cuarzo", op: "insert", records: object[] }
 *   { table: "registros_arena" | "registros_cuarzo", op: "update", id: string, patch: object }
 *   { table: "despachos",       op: "upsert", records: object[] }   // onConflict fijo: doc_entry,articulo
 *   { table: "historial_cambios", op: "insert", records: object[] }
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/apiGuard";

export const maxDuration = 60;

const TABLAS_REGISTRO = ["registros_arena", "registros_cuarzo"] as const;
type TablaRegistro = typeof TABLAS_REGISTRO[number];

function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const err = requireAdmin(session);
  if (err) return err;

  let body: {
    table?:   string;
    op?:      "insert" | "update" | "upsert";
    records?: Record<string, unknown>[];
    id?:      string;
    patch?:   Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { table, op } = body;
  const sb = getSupabaseServer();

  // ---- historial_cambios: solo insert ----
  if (table === "historial_cambios") {
    if (op !== "insert" || !Array.isArray(body.records)) {
      return NextResponse.json({ error: "historial_cambios solo admite insert de records[]" }, { status: 400 });
    }
    const { error } = await sb.from("historial_cambios").insert(body.records);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---- despachos: solo upsert con onConflict fijo ----
  if (table === "despachos") {
    if (op !== "upsert" || !Array.isArray(body.records)) {
      return NextResponse.json({ error: "despachos solo admite upsert de records[]" }, { status: 400 });
    }
    // Normalizar "articulo" — el cálculo de productividad filtra con .in("articulo", [...])
    // exacto (A36LGC/A39LGC/A37LGC). Si llega en minúsculas o con espacios desde el Excel,
    // el filtro lo descarta en silencio y el despacho nunca se suma a la producción.
    const records = body.records.map((r) => ({
      ...r,
      articulo: typeof r.articulo === "string" ? r.articulo.trim().toUpperCase() : r.articulo,
    }));
    const { data, error } = await sb
      .from("despachos")
      .upsert(records, { onConflict: "doc_entry,articulo", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: data?.length ?? 0 });
  }

  // ---- registros_arena / registros_cuarzo ----
  if (!TABLAS_REGISTRO.includes(table as TablaRegistro)) {
    return NextResponse.json({ error: `Tabla no permitida: ${table}` }, { status: 400 });
  }
  const tabla = table as TablaRegistro;

  if (op === "insert") {
    if (!Array.isArray(body.records)) return NextResponse.json({ error: "records[] requerido" }, { status: 400 });
    const { data, error } = await sb.from(tabla).insert(body.records).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, data });
  }

  if (op === "update") {
    if (!body.id || !body.patch) return NextResponse.json({ error: "id y patch requeridos" }, { status: 400 });
    const { error } = await sb.from(tabla).update(body.patch).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (op === "upsert") {
    if (!Array.isArray(body.records)) return NextResponse.json({ error: "records[] requerido" }, { status: 400 });
    const { data, error } = await sb
      .from(tabla)
      .upsert(body.records, { onConflict: "fecha_hora" })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, data });
  }

  return NextResponse.json({ error: `op no soportada: ${op}` }, { status: 400 });
}
