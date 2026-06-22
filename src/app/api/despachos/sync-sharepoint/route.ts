import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// SharePoint file - SALIDAS ROMANAS.xlsx
const GRAPH_FILE_URL =
  "https://graph.microsoft.com/v1.0/sites/inversioneselalto.sharepoint.com:/sites/ProgramacionTM:/drive/items/42593BDC-21BF-431E-97B3-073C611655CE/content";

function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Busca un valor en un objeto de fila usando múltiples posibles nombres de columna */
function col(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
    // Búsqueda case-insensitive
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === n.trim().toLowerCase()
    );
    if (key && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

/** Convierte número de serie Excel o string a fecha ISO (YYYY-MM-DD) */
function parseExcelDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    const mm = String(d.m).padStart(2, "0");
    const dd = String(d.d).padStart(2, "0");
    return `${d.y}-${mm}-${dd}`;
  }
  if (typeof val === "string") {
    // Intentar varios formatos: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY
    const s = val.trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
    if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2,"0")}-${String(dmy[1]).padStart(2,"0")}`;
    // ISO con hora
    const dtiso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (dtiso) return dtiso[1];
  }
  return null;
}

/** Extrae HH:MM desde número Excel (fracción de día) o string */
function parseExcelTime(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  if (typeof val === "string") {
    const s = val.trim();
    const hm = s.match(/(\d{1,2}):(\d{2})/);
    if (hm) return `${String(hm[1]).padStart(2,"0")}:${hm[2]}`;
  }
  return null;
}

/** Extrae número desde string con puntos/comas */
function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const clean = val.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(clean);
    return isNaN(n) ? null : n;
  }
  return null;
}

export async function POST(request: Request) {
  // Verificar sesión
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const accessToken = session.user.accessToken;
  if (!accessToken) {
    return NextResponse.json(
      { error: "No hay token de acceso. Cierra sesión y vuelve a entrar para autorizar acceso a SharePoint." },
      { status: 401 }
    );
  }

  // Parámetros opcionales
  const { searchParams } = new URL(request.url);
  const headersOnly = searchParams.get("headers") === "true";
  const sheetParam  = searchParams.get("sheet") ?? "Query1";

  try {
    // 1. Descargar archivo desde SharePoint via Graph API
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

    const buffer  = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

    // Devolver solo los encabezados si se pide
    if (headersOnly) {
      const sheetsInfo: Record<string, string[]> = {};
      for (const name of workbook.SheetNames) {
        const ws   = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1, range: 0 });
        sheetsInfo[name] = (rows[0] as string[]) ?? [];
      }
      return NextResponse.json({ sheets: workbook.SheetNames, headers: sheetsInfo });
    }

    // 2. Parsear hoja
    const ws = workbook.Sheets[sheetParam] ?? workbook.Sheets[workbook.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: `Hoja "${sheetParam}" no encontrada. Hojas disponibles: ${workbook.SheetNames.join(", ")}` }, { status: 400 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw:    true,
    });

    if (rows.length === 0) {
      return NextResponse.json({ synced: 0, skipped: 0, message: "Hoja vacía" });
    }

    // 3. Mapear filas a despachos
    const despachos: Record<string, unknown>[] = [];
    const skippedRows: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // --- Fecha ---
      const fechaRaw = col(r,
        "Fecha", "fecha", "FECHA",
        "Fecha Doc.", "Fecha Documento", "Fecha/Hora", "FechaHora",
        "Fecha Doc", "F.Documento", "Fecha Emisión"
      );
      const fecha = parseExcelDate(fechaRaw);
      if (!fecha) { skippedRows.push(i + 2); continue; } // +2: header + 1-indexed

      // --- Hora ---
      const horaRaw = col(r,
        "Hora", "hora", "HORA",
        "Hora Doc.", "Hora Documento", "Hora Despacho"
      );
      const hora = parseExcelTime(horaRaw) ?? "00:00";

      // Si la fecha tiene hora embebida (ej: "2024-01-15T14:30:00")
      let fechaFinal = fecha;
      let horaFinal  = hora;
      if (typeof fechaRaw === "string" && fechaRaw.includes("T")) {
        const parts = fechaRaw.split("T");
        fechaFinal = parseExcelDate(parts[0]) ?? fecha;
        horaFinal  = parseExcelTime(parts[1]) ?? hora;
      }

      const fecha_hora = `${fechaFinal}T${horaFinal}:00`;

      // --- Folio (clave de upsert) ---
      const folioRaw = col(r, "Folio", "folio", "FOLIO", "N° Folio", "Nro Folio", "Folio Despacho");
      const folio = parseNum(folioRaw);

      // --- Artículo ---
      const articulo = String(col(r,
        "Artículo", "Articulo", "ARTICULO", "articulo",
        "Cód. Artículo", "Cod. Articulo", "Código Artículo", "Art.", "Código Art."
      ) ?? "").trim() || null;

      // Filtrar solo arena/cuarzo
      if (articulo && !["A36LGC","A37LGC","A39LGC"].includes(articulo)) {
        // Incluir igual — puede haber otros artículos válidos
      }

      // --- Toneladas ---
      const toneladasRaw = col(r,
        "Toneladas", "toneladas", "TONELADAS",
        "Cantidad", "Cant.", "Peso Neto", "Ton.", "Peso (Ton)",
        "Cantidad (ton)", "Cant. (ton)", "Peso Neto (ton)"
      );
      const toneladas = parseNum(toneladasRaw);

      const tonConfRaw = col(r,
        "Toneladas Confirmadas", "Ton. Confirmadas", "Peso Confirmado",
        "Cantidad Confirmada"
      );
      const toneladas_confirmadas = parseNum(tonConfRaw);

      const tonFinalRaw = col(r,
        "Ton. Final", "Ton Final", "Toneladas Final", "Peso Final",
        "Toneladas Neto", "Ton. Neto"
      );
      const ton_final = parseNum(tonFinalRaw) ?? toneladas;

      // --- Otros campos ---
      const doc_entry  = parseNum(col(r, "DocEntry", "Doc. Entry", "N° DocEntry", "Entry"));
      const n_documento= parseNum(col(r, "N° Documento", "Nro. Documento", "N° Doc.", "Doc.", "Documento"));
      const cliente    = String(col(r, "Cliente", "cliente", "CLIENTE", "Cód. Cliente", "Cod. Cliente") ?? "").trim() || null;
      const nombre     = String(col(r, "Nombre", "nombre", "NOMBRE", "Nombre Cliente", "Nombre BP") ?? "").trim() || null;
      const descripcion= String(col(r, "Descripción", "Descripcion", "DESCRIPCION", "Nombre Artículo", "Desc. Artículo") ?? "").trim() || null;
      const precio     = parseNum(col(r, "Precio", "precio", "PRECIO", "Precio Unit.", "P. Unitario"));
      const total      = parseNum(col(r, "Total", "total", "TOTAL", "Monto Total", "Importe"));
      const patente    = String(col(r, "Patente", "patente", "PATENTE", "N° Patente", "Placa") ?? "").trim().toUpperCase() || null;
      const patente_acoplado = String(col(r, "Patente Acoplado", "Acoplado", "Patente Acopl.") ?? "").trim().toUpperCase() || null;
      const rut_chofer = String(col(r, "RUT Chofer", "Rut Chofer", "RUT", "rut_chofer") ?? "").trim() || null;
      const tipo       = String(col(r, "Tipo", "tipo", "TIPO", "Tipo Doc.", "Tipo Documento") ?? "").trim() || null;

      despachos.push({
        tipo,
        doc_entry,
        n_documento,
        folio,
        fecha: fechaFinal,
        hora:  horaFinal + ":00",
        fecha_hora,
        cliente,
        nombre,
        articulo,
        descripcion,
        toneladas,
        toneladas_confirmadas,
        ton_final,
        precio,
        total,
        patente,
        patente_acoplado,
        rut_chofer,
      });
    }

    if (despachos.length === 0) {
      return NextResponse.json({
        synced: 0,
        skipped: skippedRows.length,
        skippedRows,
        message: "No se encontraron filas válidas (verificar columnas de fecha)",
      });
    }

    // 4. Upsert a Supabase
    const sb = getSupabaseServer();

    // Dividir en lotes de 500 para evitar timeouts
    const BATCH = 500;
    let totalUpserted = 0;
    const errors: string[] = [];

    // Separar filas con folio (upsert) y sin folio (insert ignorando duplicados por fecha_hora+articulo)
    const withFolio    = despachos.filter((d) => d.folio !== null);
    const withoutFolio = despachos.filter((d) => d.folio === null);

    // Upsert por folio
    for (let i = 0; i < withFolio.length; i += BATCH) {
      const batch = withFolio.slice(i, i + BATCH);
      const { error, count } = await sb
        .from("despachos")
        .upsert(batch, { onConflict: "folio", ignoreDuplicates: false })
        .select("id", { count: "exact", head: true });
      if (error) errors.push(`Lote ${i}-${i+BATCH}: ${error.message}`);
      else totalUpserted += count ?? batch.length;
    }

    // Insert sin folio — ignorar duplicados por fecha_hora + articulo si la columna existe
    for (let i = 0; i < withoutFolio.length; i += BATCH) {
      const batch = withoutFolio.slice(i, i + BATCH);
      const { error, count } = await sb
        .from("despachos")
        .upsert(batch, { onConflict: "fecha_hora,articulo", ignoreDuplicates: true })
        .select("id", { count: "exact", head: true });
      if (error) errors.push(`Sin folio lote ${i}: ${error.message}`);
      else totalUpserted += count ?? 0;
    }

    return NextResponse.json({
      synced:      totalUpserted,
      total_rows:  despachos.length,
      skipped:     skippedRows.length,
      errors:      errors.length > 0 ? errors : undefined,
      message:     `${totalUpserted} despachos sincronizados desde SharePoint`,
    });
  } catch (e: unknown) {
    console.error("[sync-sharepoint] error:", e);
    return NextResponse.json(
      { error: `Error interno: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

// GET: solo devuelve encabezados/info del archivo
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const accessToken = session.user.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Sin token de acceso" }, { status: 401 });
  }

  try {
    const fileRes = await fetch(GRAPH_FILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      return NextResponse.json({ error: `Graph API error ${fileRes.status}` }, { status: 502 });
    }

    const buffer   = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const sheetsInfo: Record<string, { headers: string[]; rows: number }> = {};

    for (const name of workbook.SheetNames) {
      const ws   = workbook.Sheets[name];
      const all  = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      sheetsInfo[name] = {
        headers: (all[0] ?? []).map(String),
        rows:    Math.max(0, all.length - 1),
      };
    }

    return NextResponse.json({ sheets: workbook.SheetNames, info: sheetsInfo });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
