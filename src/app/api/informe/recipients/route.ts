/**
 * GET  /api/informe/recipients?planta=sur|turco|peral
 * GET  /api/informe/recipients?planta=sur&tipo=default  → carga emails predeterminados
 * PUT  /api/informe/recipients  body: { planta, recipients }
 * PUT  /api/informe/recipients  body: { planta, tipo:"default", emails:string[] }
 *
 * Claves en configuracion:
 *   sur   → report_recipients       / sur_default_emails
 *   turco → turco_recipients        / turco_default_emails
 *   peral → peral_recipients        / peral_default_emails
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

const CLAVE_DEFAULT: Record<Planta, string> = {
  sur:   "sur_default_emails",
  turco: "turco_default_emails",
  peral: "peral_default_emails",
};

const SEED: Record<Planta, Destinatario[]> = {
  sur: [
    { email: "sarce@migrin.cl",           nombre: "Sebastián Arce González",  activo: true  },
    { email: "jtorres@migrin.cl",         nombre: "Javier Torres",            activo: true  },
    { email: "nmerino@migrin.cl",         nombre: "Nicolás Merino",           activo: true  },
    { email: "ajofre@migrin.cl",          nombre: "Alejandro Jofré",          activo: true  },
    { email: "daguilera@migrin.cl",       nombre: "Diego Aguilera",           activo: true  },
    { email: "bveliz.molina@migrin.cl",   nombre: "Benjamín Véliz",           activo: true  },
    { email: "jefeturnomlp@migrin.cl",    nombre: "Jefe Turno MLP",           activo: true  },
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
    { email: "cayala@migrin.cl",    nombre: "Cristian Ayala",           activo: true },
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
    const { data } = await getClient()
      .from("configuracion").select("valor").eq("clave", CLAVE[planta]).maybeSingle();
    if (!data?.valor) return SEED[planta];
    const saved = JSON.parse(data.valor) as Destinatario[];
    // Agregar entradas del SEED que no existan aún en la lista guardada
    const extras = SEED[planta].filter(s => !saved.some(r => r.email === s.email));
    return extras.length > 0 ? [...saved, ...extras] : saved;
  } catch { return SEED[planta]; }
}

async function loadDefaultEmails(planta: Planta): Promise<string[] | null> {
  try {
    const { data } = await getClient()
      .from("configuracion").select("valor").eq("clave", CLAVE_DEFAULT[planta]).maybeSingle();
    if (!data?.valor) return null;
    return JSON.parse(data.valor) as string[];
  } catch { return null; }
}

export async function GET(req: Request) {
  const url    = new URL(req.url);
  const planta = parsePlanta(url.searchParams.get("planta"));
  const tipo   = url.searchParams.get("tipo");

  try {
    if (tipo === "default") {
      const emails = await loadDefaultEmails(planta);
      return NextResponse.json({ defaultEmails: emails, planta });
    }
    const [recipients, defaultEmails] = await Promise.all([
      loadRecipients(planta),
      loadDefaultEmails(planta),
    ]);
    return NextResponse.json({ recipients, defaultEmails, planta });
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

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey)
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurada" }, { status: 500 });

    const body = await req.json() as {
      planta?: string;
      tipo?:   string;
      recipients?: Destinatario[];
      emails?: string[];
    };
    const planta = parsePlanta(body.planta ?? null);
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

    // Guardar predeterminado (solo lista de emails)
    if (body.tipo === "default") {
      const emails = body.emails;
      if (!Array.isArray(emails))
        return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
      const { error } = await client.from("configuracion").upsert(
        { clave: CLAVE_DEFAULT[planta], valor: JSON.stringify(emails) },
        { onConflict: "clave" }
      );
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, tipo: "default", planta, saved: emails.length });
    }

    // Guardar lista completa (activo/inactivo)
    const { recipients } = body;
    if (!Array.isArray(recipients))
      return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
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
