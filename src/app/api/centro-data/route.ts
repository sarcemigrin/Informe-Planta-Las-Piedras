/**
 * GET /api/centro-data
 * Devuelve los últimos registros de registros_turco y registros_peral.
 * Usa service role key para saltar RLS.
 */
import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions }      from "@/lib/authOptions";
import { createClient }     from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200"), 500);

  const sb = getAdmin();
  const [{ data: turco, error: eTurco }, { data: peral, error: ePeral }] = await Promise.all([
    sb.from("registros_turco").select("*").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(limit),
    sb.from("registros_peral").select("*").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(limit),
  ]);

  if (eTurco) console.error("[centro-data] turco:", eTurco.message);
  if (ePeral) console.error("[centro-data] peral:", ePeral.message);

  if (process.env.NODE_ENV !== "production") {
    console.log("[centro-data] turco:", turco?.length ?? 0, "peral:", peral?.length ?? 0);
  }
  return NextResponse.json({
    turco: turco ?? [],
    peral: peral ?? [],
    _debug: { turcoError: eTurco?.message, peralError: ePeral?.message },
  });
}
