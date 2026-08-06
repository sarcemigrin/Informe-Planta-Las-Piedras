/**
 * GET  /api/centro-data          — Devuelve registros de registros_turco y registros_peral.
 * POST /api/centro-data          — Inserta un registro usando service role (bypasa RLS).
 *
 * Usa service role key para saltar RLS en ambas operaciones.
 */
import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/authOptions";
import { createClient }     from "@supabase/supabase-js";
import { requireAdmin }     from "@/lib/apiGuard";

export const dynamic = "force-dynamic";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200"), 500);

  const sb = getAdmin();
  const [{ data: turco, error: eTurco }, { data: peral, error: ePeral }] = await Promise.all([
    sb.from("registros_turco").select("*").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(2000),
    sb.from("registros_peral").select("*").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(2000),
  ]);

  if (eTurco) console.error("[centro-data] turco:", eTurco.message);
  if (ePeral) console.error("[centro-data] peral:", ePeral.message);

  return NextResponse.json(
    {
      turco: turco ?? [],
      peral: peral ?? [],
      _debug: { turcoCount: turco?.length ?? 0, peralCount: peral?.length ?? 0, turcoError: eTurco?.message, peralError: ePeral?.message },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

const ALLOWED_TABLES = ["registros_peral", "registros_turco"] as const;
type AllowedTable = typeof ALLOWED_TABLES[number];

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const err = requireAdmin(session);
  if (err) return err;

  let body: { table: AllowedTable; record: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { table, record } = body;
  if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
    return NextResponse.json({ error: `Tabla no permitida: ${table}` }, { status: 400 });
  }
  if (!record || typeof record !== "object") {
    return NextResponse.json({ error: "Record inválido" }, { status: 400 });
  }

  const sb = getAdmin();
  const { data, error } = await sb.from(table).insert(record).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Insert silencioso — 0 filas insertadas" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
}
