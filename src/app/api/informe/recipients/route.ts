/**
 * GET  /api/informe/recipients  — lista todos los destinatarios
 * PUT  /api/informe/recipients  — guarda la lista completa (solo admin)
 *
 * Almacena en tabla `configuracion`, clave `report_recipients`, como JSON string.
 */

import { NextResponse }     from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions }      from "@/lib/authOptions";
import { createClient }     from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export interface Destinatario {
  email:  string;
  nombre: string;
  activo: boolean;
}

// Lista base — se usa como semilla si no existe registro en DB
const SEED: Destinatario[] = [
  { email: "sarce@migrin.cl",            nombre: "Sebastian Arce",          activo: true  },
  { email: "jtorres@migrin.cl",          nombre: "J Torres",                activo: true  },
  { email: "rpesce@gestionelalto.cl",    nombre: "Roberto Pesce Martínez",  activo: false },
  { email: "rconcha@gestionelalto.cl",   nombre: "Rodrigo Concha",          activo: false },
  { email: "efernandez@migrin.cl",       nombre: "Esteban Fernández",       activo: false },
  { email: "rbernadot@migrin.cl",        nombre: "Reinaldo Bernadot",       activo: false },
  { email: "rpe@gestionelalto.cl",       nombre: "Roberto Pesce Eguiguren", activo: false },
  { email: "dcampos@gestionelalto.cl",   nombre: "Diego Campos",            activo: false },
  { email: "fpollock@gestionelalto.cl",  nombre: "Felipe Pollock",          activo: false },
];

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada en Vercel");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

async function loadRecipients(): Promise<Destinatario[]> {
  try {
    const { data } = await anonClient()
      .from("configuracion")
      .select("valor")
      .eq("clave", "report_recipients")
      .maybeSingle();

    if (!data?.valor) return SEED;
    return JSON.parse(data.valor) as Destinatario[];
  } catch {
    return SEED;
  }
}

export async function GET() {
  try {
    const recipients = await loadRecipients();
    return NextResponse.json({ recipients });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.rol !== "admin") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const { recipients } = await req.json() as { recipients: Destinatario[] };
    if (!Array.isArray(recipients)) {
      return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
    }

    const { error } = await serviceClient()
      .from("configuracion")
      .upsert({ clave: "report_recipients", valor: JSON.stringify(recipients) }, { onConflict: "clave" });

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, saved: recipients.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
