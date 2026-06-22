import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// SALIDAS ROMANAS.xlsx en SharePoint
const GRAPH_FILE_URL =
  "https://graph.microsoft.com/v1.0/sites/inversioneselalto.sharepoint.com:/sites/ProgramacionTM:/drive/root:/SALIDAS%20ROMANAS.xlsx:/content";

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

function parseExcelDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  if (typeof val === "string") {
    const s = val.trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
    if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2,"0")}-${String(dmy[1]).padStart(2,"0")}`;
    const dtiso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (dtiso) return dtiso[1];
  }
  return null;
}

function parseExcelTime(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    const total = Math.round(val * 24 * 60);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  if (typeof val === "string") {
    const hm = val.trim().match(/(\d{1,2}):(\d{2})/);
    if (hm) return `${String(hm[1]).padStart(2,"0")}:${hm[2]}`;
  }
  return null;
}

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/\./g,"").replace(",","."));
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseRows(ws: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  const despachos: Record<string, unknown>[] = [];
  const skipped: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fechaRaw = col(r,
      "Fecha","fecha","FECHA","Fecha Doc.","Fecha Documento",
      "Fecha/Hora","FechaHora","Fecha Doc","F.Documento","Fecha Emisión"
    );
    let fecha = parseExcelDate(fechaRaw);
    if (!fecha) { skipped.push(i + 2); continue; }

    const horaRaw = col(r,"Hora","hora","HORA","Hora Doc.","Hora Documento","Hora Despacho");
    let hora = parseExcelTime(horaRaw) ?? "00:00";

    if (typeof fechaRaw === "string" && fechaRaw.includes("T")) {
      const p = fechaRaw.split("T");
      fecha = parseExcelDate(p[0]) ?? fecha;
      hora  = parseExcelTime(p[1]) ?? hora;
    }

    despachos.push({
      tipo:         String(col(r,"Tipo","tipo","TIPO","Tipo Doc.","Tipo Documento") ?? "").trim() || null,
      doc_entry:    parseNum(col(r,"DocEntry","Doc. Entry","N° DocEntry","Entry")),
      n_documento:  parseNum(col(r,"N° Documento","Nro. Documento","N° Doc.","Doc.","Documento")),
      folio:        parseNum(col(r,"Folio","folio","FOLIO","N° Folio","Nro Folio","Folio Despacho")),
      fecha,
      hora:         hora + ":00",
      fecha_hora:   `${fecha}T${hora}:00`,
      cliente:      String(col(r,"Cliente","cliente","CLIENTE","Cód. Cliente","Cod. Cliente") ?? "").trim() || null,
      nombre:       String(col(r,"Nombre","nombre","NOMBRE","Nombre Cliente","Nombre BP") ?? "").trim() || null,
      articulo:     String(col(r,"Artículo","Articulo","ARTICULO","articulo","Cód. Artículo","Cod. Articulo","Código Artículo","Art.") ?? "").trim() || null,
      descripcion:  String(col(r,"Descripción","Descripcion","DESCRIPCION","Nombre Artículo","Desc. Artículo") ?? "").trim() || null,
      toneladas:    parseNum(col(r,"Toneladas","toneladas","TONELADAS","Cantidad","Cant.","Peso Neto","Ton.","Peso (Ton)","Cantidad (ton)")),
      toneladas_confirmadas: parseNum(col(r,"Toneladas Confirmadas","Ton. Confirmadas","Peso Confirmado")),
      ton_final:    parseNum(col(r,"Ton. Final","Ton Final","Toneladas Final","Peso Final","Toneladas Neto","Ton. Neto"))
                    ?? parseNum(col(r,"Toneladas","toneladas","Cantidad","Peso Neto")),
      precio:       parseNum(col(r,"Precio","precio","PRECIO","Precio Unit.","P. Unitario")),
      total:        parseNum(col(r,"Total","total","TOTAL","Monto Total","Importe")),
      patente:      String(col(r,"Patente","patente","PATENTE","N° Patente","Placa") ?? "").trim().toUpperCase() || null,
      patente_acoplado: String(col(r,"Patente Acoplado","Acoplado","Patente Acopl.") ?? "").trim().toUpperCase() || null,
      rut_chofer:   String(col(r,"RUT Chofer","Rut Chofer","RUT","rut_chofer") ?? "").trim() || null,
    });
  }
  return { despachos, skipped };
}

async function upsertDespachos(despachos: Record<string, unknown>[]) {
  const sb = getSupabaseServer();
  const BATCH = 500;
  let total = 0;
  const errors: string[] = [];
  const withFolio    = despachos.filter((d) => d.folio !== null);
  const withoutFolio = despachos.filter((d) => d.folio === null);

  for (let i = 0; i < withFolio.length; i += BATCH) {
    const { error, count } = await sb
      .from("despachos")
      .upsert(withFolio.slice(i, i + BATCH), { onConflict: "folio", ignoreDuplicates: false })
      .select("id", { count: "exact", head: true });
    if (error) errors.push(error.message);
    else total += count ?? withFolio.slice(i, i + BATCH).length;
  }
  for (let i = 0; i < withoutFolio.length; i += BATCH) {
    const { error, count } = await sb
      .from("despachos")
      .upsert(withoutFolio.slice(i, i + BATCH), { onConflict: "fecha_hora,articulo", ignoreDuplicates: true })
      .select("id", { count: "exact", head: true });
    if (error) errors.push(error.message);
    else total += count ?? 0;
  }
  return { total, errors };
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user)               return NextResponse.json({ error: "No autenticado" },  { status: 401 });
  if (session.user.rol !== "admin") return NextResponse.json({ error: "Sin permisos" },    { status: 403 });

  const accessToken = session.user.accessToken;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Sin token de acceso. Cierra sesión y vuelve a entrar para autorizar Files.Read." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const sheetParam = searchParams.get("sheet") ?? "base";

  try {
    // Descargar archivo desde SharePoint via Graph API
    const fileRes = await fetch(GRAPH_FILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!fileRes.ok) {
      const err = await fileRes.text();
      return NextResponse.json(
        { error: `Error al obtener archivo de SharePoint (${fileRes.status}): ${err}` },
        { status: 502 }
      );
    }

    const buffer   = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

    const ws = workbook.Sheets[sheetParam] ?? workbook.Sheets[workbook.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({
        error: `Hoja "${sheetParam}" no encontrada. Hojas: ${workbook.SheetNames.join(", ")}`,
      }, { status: 400 });
    }

    const { despachos, skipped } = parseRows(ws);
    if (despachos.length === 0) {
      return NextResponse.json({ synced: 0, skipped: skipped.length, message: "Sin filas válidas" });
    }

    const { total, errors } = await upsertDespachos(despachos);

    return NextResponse.json({
      synced:     total,
      total_rows: despachos.length,
      skipped:    skipped.length,
      sheets:     workbook.SheetNames,
      errors:     errors.length ? errors : undefined,
      message:    `${total} despachos sincronizados desde SharePoint`,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET — inspeccionar encabezados del archivo (debug)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.rol !== "admin")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const accessToken = session.user.accessToken;
  if (!accessToken) return NextResponse.json({ error: "Sin token" }, { status: 401 });

  try {
    const fileRes = await fetch(GRAPH_FILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) return NextResponse.json({ error: `Graph API ${fileRes.status}` }, { status: 502 });

    const buffer   = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const info: Record<string, { headers: string[]; rows: number }> = {};

    for (const name of workbook.SheetNames) {
      const ws  = workbook.Sheets[name];
      const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      info[name] = { headers: (all[0] ?? []).map(String), rows: Math.max(0, all.length - 1) };
    }
    return NextResponse.json({ sheets: workbook.SheetNames, info });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
