/**
 * GET /api/vuelos
 * Devuelve los dates de vuelos realizados para las 3 plantas.
 * Usa service role para saltar RLS.
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

export async function GET() {
  const sb = getAdmin();

  const [
    { data: turco },
    { data: peral },
    { data: piedras },
  ] = await Promise.all([
    sb.from("registros_turco").select("fecha").order("fecha", { ascending: false }).limit(2000),
    sb.from("registros_peral").select("fecha").order("fecha", { ascending: false }).limit(2000),
    sb.from("registros_arena").select("fecha").order("fecha", { ascending: false }).limit(2000),
  ]);

  // Conjuntos únicos de fechas por planta
  const toSet = (rows: { fecha: string }[] | null) =>
    Array.from(new Set((rows ?? []).map((r) => r.fecha)));

  return NextResponse.json(
    {
      turco:   toSet(turco),
      peral:   toSet(peral),
      piedras: toSet(piedras),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
