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

// GET /api/anotaciones — cualquier usuario autenticado puede leer
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const anio = searchParams.get("anio") ?? new Date().getFullYear().toString();

  const { data, error } = await getAdmin()
    .from("anotaciones_diario")
    .select("fecha, motivo")
    .gte("fecha", `${anio}-01-01`)
    .lte("fecha", `${anio}-12-31`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/anotaciones — solo admin puede escribir
export async function POST(req: Request) {
  const ctErr = requireJson(req);
  if (ctErr) return ctErr;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.rol !== "admin") {
    return NextResponse.json({ error: "Solo administradores pueden guardar anotaciones" }, { status: 403 });
  }

  const { fecha, motivo } = await req.json() as { fecha?: string; motivo?: string };
  if (!fecha || !motivo?.trim()) {
    return NextResponse.json({ error: "fecha y motivo requeridos" }, { status: 400 });
  }

  const { error } = await getAdmin()
    .from("anotaciones_diario")
    .upsert({ fecha, motivo: motivo.trim() }, { onConflict: "fecha" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
