/**
 * GET  /api/informe/recipients?planta=sur|turco|peral
 * PUT  /api/informe/recipients  body: { planta, recipients }
 *
 * Claves en tabla `configuracion`:
 *   sur   → report_recipients
 *   turco → turco_recipients
 *   peral → peral_recipients
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

type Planta = "sur" | "turco" | "peral";

const CLAVE: Record<Planta, string> = {
  sur:   "report_recipients",
  turco: "turco_recipients",
  peral: "peral_recipients",
};

const SEED: Record<Planta, Destinatario[]> = {
  sur: [
    { email: "sarce@migrin.cl",           nombre: "Sebastián Arce González",  activo: true  },
    { email: "jtorres@migrin.cl",         nombre: "Javier Torres",            activo: true  },
    { email: "rpesce@gestionelalto.cl",   nombre: "Roberto Pesce Martínez",   activo: false },
    { email: "rconcha@gestionelalto.cl",  nombre: "Rodrigo Concha",           activo: false },
    { email: "efernandez@migrin.cl",      nombre: "Esteban Fernández",        activo: false },
    { email: "rbernadot@migrin.cl",       nombre: "Reinaldo Bernadot",        activo: false },
    { email: "rpe@gestionelalto.cl",      nombre: "Roberto Pesce Eguiguren",  activo: false },
    { email: "dcampos@gestionelalto.cl",  nombre: "Diego Campos",             activo: false },
    { email: "fpollock@gestionelalto.cl", nombre: "Felipe Pollock",           activo: false },
  ],
  turco: [
    { email: "efernandez@migrin.cl",     nombre: "Esteban Fernández",       activo: true },
    { email: "ajerez@migrin.cl",         nombre: "Aldo Jerez",              activo: true },
    { email: "lreyes@migrin.cl",         nombre: "Lucas Reyes",             activo: true },
    { email: "jefeturnoturco@migrin.cl", nombre: "Jefe Turno Turco",        activo: true },
    { email: "cayala@migrin.cl",         nombre: "Cristian Ayala",          activo: true },
    { email: "jtorres@migrin.cl",        nombre: "Javier Torres",           activo: true },
    { email: "sarce@migrin.cl",          nombre: "Sebastián Arce González", activo: true },
  ],
  peral: [
    { email: "ajerez@migrin.cl",    nombre: "Aldo Jerez",               activo: true },
    { email: "amendez@migrin.cl",   nombre: "Alejandro Méndez",         activo: true },
    { email: "efernandez@migrin.cl",nombre: "Esteban Fernández",        activo: true },
    { email: "jtorres@migrin.cl",   nombre: "Javier Torres Salazar",    activo: true },
    { email: "sarce@migrin.cl",     nombre: "Sebastián Arce González",  activo: true },
  ],
};

function getClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

function parsePlanta(raw: string | null): Planta {
  if (raw === "turco" || raw === "peral") return raw;
  return "sur";
}

async function loadRecipients(planta: Planta): Promise<Destinatario[]> {
  try {
    const { data, error } = await getClient()
      .from("configuracion")
      .select("valor")
      .eq("clave", CLAVE[planta])
      .maybeSingle();
    if (error || !data?.valor) return SEED[planta];
    return JSON.parse(data.valor) as Destinatario[];
  } catch {
    return SEED[planta];
  }
}

export async function GET(req: Request) {
  const planta = parsePlanta(new URL(req.url).searchParams.get("planta"));
  try {
    const recipients = await loadRecipients(planta);
    return NextResponse.json({ recipients, planta });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user)
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    if (session.user.rol !== "admin")
      return NextResponse.json({ error: "Sin permisos. Se requiere rol admin." }, { status: 403 });

    const body = await req.json() as { planta?: string; recipients: Destinatario[] };
    const planta = parsePlanta(body.planta ?? null);
    const { recipients } = body;

    if (!Array.isArray(recipients))
      return NextResponse.json({ error: "Formato inválido" }, { status: 400 });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey)
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurada" }, { status: 500 });

    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
    const { error } = await client.from("configuracion").upsert(
      { clave: CLAVE[planta], valor: JSON.stringify(recipients) },
      { onConflict: "clave" }
    );

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, planta, saved: recipients.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
