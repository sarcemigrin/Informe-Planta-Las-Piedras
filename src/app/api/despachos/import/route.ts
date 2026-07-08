import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/despachos/import
 *
 * Recibe un array de filas desde Power Automate (Excel Online → List rows)
 * y las upsertea en la tabla despachos de Supabase.
 *
 * Autenticación: header  Authorization: Bearer {DESPACHOS_API_KEY}
 *
 * Body esperado (dos formatos soportados):
 *   1. Array directo:  [ { "Fecha": "...", "Hora": "...", ... }, ... ]
 *   2. Objeto Power Automate:  { "value": [ ... ] }
 */

function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function col(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === n.trim().toLowerCase()
    );
    if (key && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

function parseDate(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  // ISO: 2024-01-15 o 2024-01-15T...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY o DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2,"0")}-${String(dmy[1]).padStart(2,"0")}`;
  return null;
}

function parseTime(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  const hm = s.match(/(\d{1,2}):(\d{2})/);
  if (hm) return `${String(hm[1]).padStart(2,"0")}:${hm[2]}`;
  return null;
}

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  const n = parseFloat(String(val).replace(/\./g,"").replace(",","."));
  return isNaN(n) ? null : n;
}

function mapRow(r: Record<string, unknown>): Record<string, unknown> | null {
  // Fecha — obligatoria
  const fechaRaw = col(r,
    "Fecha","fecha","FECHA","Fecha Doc.","Fecha Documento",
    "Fecha/Hora","FechaHora","Fecha Doc","F.Documento","Fecha Emisión"
  );
  let fecha = parseDate(fechaRaw);
  if (!fecha) return null;

  const horaRaw = col(r,"Hora","hora","HORA","Hora Doc.","Hora Documento","Hora Despacho");
  let hora = parseTime(horaRaw) ?? "00:00";

  // Si fecha tiene hora embebida (ISO datetime)
  if (typeof fechaRaw === "string" && fechaRaw.includes("T")) {
    const p = fechaRaw.split("T");
    fecha = parseDate(p[0]) ?? fecha;
    hora  = parseTime(p[1]) ?? hora;
  }

  return {
    tipo:         String(col(r,"Tipo","tipo","TIPO","Tipo Doc.","Tipo Documento") ?? "").trim() || null,
    doc_entry:    parseNum(col(r,"DocEntry","Doc. Entry","N° DocEntry","Entry")),
    n_documento:  parseNum(col(r,"N° Documento","Nro. Documento","N° Doc.","Documento")),
    folio:        parseNum(col(r,"Folio","folio","FOLIO","N° Folio","Nro Folio","Folio Despacho")),
    fecha,
    hora:         hora + ":00",
    fecha_hora:   `${fecha}T${hora}:00`,
    cliente:      String(col(r,"Cliente","cliente","CLIENTE","Cód. Cliente","Cod. Cliente") ?? "").trim() || null,
    nombre:       String(col(r,"Nombre","nombre","NOMBRE","Nombre Cliente","Nombre BP") ?? "").trim() || null,
    articulo:     String(col(r,"Artículo","Articulo","ARTICULO","articulo","Cód. Artículo","Cod. Articulo","Art.") ?? "").trim() || null,
    descripcion:  String(col(r,"Descripción","Descripcion","DESCRIPCION","Nombre Artículo","Desc. Artículo") ?? "").trim() || null,
    toneladas:    parseNum(col(r,"Toneladas","toneladas","TONELADAS","Cantidad","Cant.","Peso Neto","Ton.","Peso (Ton)","Cantidad (ton)")),
    toneladas_confirmadas: parseNum(col(r,"Toneladas Confirmadas","Ton. Confirmadas","Peso Confirmado")),
    ton_final:    parseNum(col(r,"Ton. Final","Ton Final","Toneladas Final","Toneladas Neto","Ton. Neto"))
                  ?? parseNum(col(r,"Toneladas","toneladas","Cantidad","Peso Neto")),
    precio:       parseNum(col(r,"Precio","precio","PRECIO","Precio Unit.","P. Unitario")),
    total:        parseNum(col(r,"Total","total","TOTAL","Monto Total","Importe")),
    patente:      String(col(r,"Patente","patente","PATENTE","N° Patente","Placa") ?? "").trim().toUpperCase() || null,
    patente_acoplado: String(col(r,"Patente Acoplado","Acoplado","Patente Acopl.") ?? "").trim().toUpperCase() || null,
    rut_chofer:   String(col(r,"RUT Chofer","Rut Chofer","RUT","rut_chofer") ?? "").trim() || null,
  };
}

export async function POST(request: Request) {
  // Verificar API key
  const apiKey = process.env.DESPACHOS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "DESPACHOS_API_KEY no configurada en el servidor" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const providedKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (providedKey !== apiKey) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido — se esperaba JSON" }, { status: 400 });
  }

  // Aceptar array directo o { value: [...] } (formato Power Automate)
  let rows: Record<string, unknown>[];
  if (Array.isArray(body)) {
    rows = body as Record<string, unknown>[];
  } else if (body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).value)) {
    rows = (body as { value: Record<string, unknown>[] }).value;
  } else {
    return NextResponse.json({ error: "Body debe ser un array o { value: [...] }" }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ synced: 0, message: "Sin filas recibidas" });
  }

  const despachos: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const r of rows) {
    const mapped = mapRow(r);
    if (!mapped) { skipped++; continue; }
    despachos.push(mapped);
  }

  if (despachos.length === 0) {
    return NextResponse.json({ synced: 0, skipped, message: "Sin filas válidas — verificar columnas de fecha" });
  }

  const sb = getSupabaseServer();
  const BATCH = 500;
  let total = 0;
  const errors: string[] = [];

  const withFolio    = despachos.filter((d) => d.folio !== null);
  const withoutFolio = despachos.filter((d) => d.folio === null);

  for (let i = 0; i < withFolio.length; i += BATCH) {
    const { data, error } = await sb
      .from("despachos")
      .upsert(withFolio.slice(i, i + BATCH), { onConflict: "folio", ignoreDuplicates: false })
      .select("id");
    if (error) errors.push(error.message);
    else total += data?.length ?? withFolio.slice(i, i + BATCH).length;
  }

  for (let i = 0; i < withoutFolio.length; i += BATCH) {
    const { data, error } = await sb
      .from("despachos")
      .upsert(withoutFolio.slice(i, i + BATCH), { onConflict: "fecha_hora,articulo", ignoreDuplicates: true })
      .select("id");
    if (error) errors.push(error.message);
    else total += data?.length ?? 0;
  }

  return NextResponse.json({
    synced:     total,
    total_rows: despachos.length,
    skipped,
    errors:     errors.length ? errors : undefined,
    message:    `${total} despachos importados`,
  });
}
