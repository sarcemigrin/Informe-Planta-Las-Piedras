/**
 * GET /api/centro-data
 * Devuelve registros de registros_turco y registros_peral.
 * Usa service role key para saltar RLS.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    sb.from("registros_turco").select("*").order("fecha_hora", { ascending: false, nullsFirst: false }).limit(2000),
    sb.from("registros_peral").select("*").order("fecha_hora", { ascending: false, nullsFirst: false }).limit(2000),
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
