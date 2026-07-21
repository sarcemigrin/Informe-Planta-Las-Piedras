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
    sb.from("registros_turco").select("*").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(limit),
    sb.from("registros_peral").select("*").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(limit),
  ]);

  if (eTurco) console.error("[centro-data] turco:", eTurco.message);
  if (ePeral) console.error("[centro-data] peral:", ePeral.message);

  // Deduplicar por fecha_hora (registros guardados más de una vez)
  const dedup = <T extends { fecha_hora: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter(r => {
      if (seen.has(r.fecha_hora)) return false;
      seen.add(r.fecha_hora);
      return true;
    });
  };

  return NextResponse.json({
    turco: dedup(turco ?? []),
    peral: dedup(peral ?? []),
    _debug: { turcoCount: turco?.length ?? 0, peralCount: peral?.length ?? 0, turcoError: eTurco?.message, peralError: ePeral?.message },
  });
}
