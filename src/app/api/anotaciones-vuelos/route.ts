/**
 * GET  /api/anotaciones-vuelos?anio=YYYY  — lista anotaciones por planta
 * POST /api/anotaciones-vuelos            — upsert { fecha, planta, motivo }
 */
import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions }      from "@/lib/authOptions";
import { requireJson }      from "@/lib/apiGuard";
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
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const anio = searchParams.get("anio") ?? new Date().getFullYear().toString();

  const { data, error } = await getAdmin()
    .from("anotaciones_vuelos")
    .select("fecha, planta, motivo")
    .gte("fecha", `${anio}-01-01`)
    .lte("fecha", `${anio}-12-31`)
    .order("fecha", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const ctErr = requireJson(req);
  if (ctErr) return ctErr;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.user.rol !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const { fecha, planta, motivo } = await req.json() as {
    fecha?: string; planta?: string; motivo?: string;
  };

  if (!fecha || !planta || !motivo?.trim()) {
    return NextResponse.json({ error: "fecha, planta y motivo requeridos" }, { status: 400 });
  }

  const plantasValidas = ["turco", "peral", "piedras"];
  if (!plantasValidas.includes(planta)) {
    return NextResponse.json({ error: "planta inválida" }, { status: 400 });
  }

  const { error } = await getAdmin()
    .from("anotaciones_vuelos")
    .upsert({ fecha, planta, motivo: motivo.trim() }, { onConflict: "fecha,planta" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
