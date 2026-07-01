import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// Busca BBDD Despachos VBA.xlsm, .xlsm o .xlsx en todo el drive del usuario
const ONEDRIVE_FILE_NAMES = ["BBDD Despachos.xlsx", "BBDD Despachos.xlsm", "BBDD Despachos VBA.xlsm"];

interface DriveItem {
  name: string;
  id: string;
  lastModifiedDateTime?: string;
  parentReference?: { path?: string };
}

async function findFileInFolder(accessToken: string, folderId: string): Promise<DriveItem | null> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`,
    { headers: { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-cache" } }
  );
  if (!res.ok) return null;
  const { value } = await res.json() as { value: DriveItem[] };
  return value.find((f) => ONEDRIVE_FILE_NAMES.includes(f.name)) ?? null;
}

async function searchFileInDrive(accessToken: string, driveId: string): Promise<{ file: DriveItem; driveId: string } | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-cache" };

  // Buscar desde la raíz del drive
  const rootRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`, { headers });
  if (!rootRes.ok) return null;
  const { value: rootItems } = await rootRes.json() as { value: DriveItem[] };

  // 1) Buscar directo en la raíz
  const rootFile = rootItems.find((f) => ONEDRIVE_FILE_NAMES.includes(f.name));
  if (rootFile) return { file: rootFile, driveId };

  // 2) Buscar en subcarpeta "Ing Planificación y Control Gestión"
  const ingFolder = rootItems.find((f) =>
    f.name.toLowerCase().includes("planificaci") || f.name.toLowerCase().includes("control gesti")
  );
  if (ingFolder) {
    const ingRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${ingFolder.id}/children`, { headers });
    if (ingRes.ok) {
      const { value: ingItems } = await ingRes.json() as { value: DriveItem[] };

      // Directo en esa carpeta
      const ingFile = ingItems.find((f) => ONEDRIVE_FILE_NAMES.includes(f.name));
      if (ingFile) return { file: ingFile, driveId };

      // En subcarpeta "Reporte"
      const reporteFolder = ingItems.find((f) => f.name.toLowerCase().includes("reporte"));
      if (reporteFolder) {
        const reporteRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${reporteFolder.id}/children`, { headers });
        if (reporteRes.ok) {
          const { value: reporteItems } = await reporteRes.json() as { value: DriveItem[] };
          const file = reporteItems.find((f) => ONEDRIVE_FILE_NAMES.includes(f.name));
          if (file) return { file, driveId };
        }
      }
    }
  }

  return null;
}

async function getOneDriveFileInfo(accessToken: string): Promise<{ url: string; lastModified: string | null }> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-cache" };

  // 1) Obtener todos los drives del usuario (personal + business + SharePoint)
  const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/me/drives`, { headers });
  const driveNames: string[] = [];

  const rootDebugItems: string[] = [];
  if (drivesRes.ok) {
    const { value: drives } = await drivesRes.json() as { value: { id: string; name: string; driveType: string }[] };
    driveNames.push(...drives.map((d) => `${d.name}(${d.driveType})`));

    for (const drive of drives) {
      // Debug: listar raíz del drive
      const rootRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive.id}/root/children`, { headers });
      if (rootRes.ok) {
        const { value: rootItems } = await rootRes.json() as { value: DriveItem[] };
        rootDebugItems.push(...rootItems.map((f) => f.name));
      }

      const result = await searchFileInDrive(accessToken, drive.id);
      if (result) {
        return {
          url:          `https://graph.microsoft.com/v1.0/drives/${result.driveId}/items/${result.file.id}/content`,
          lastModified: result.file.lastModifiedDateTime ?? null,
        };
      }
    }
  }

  // 2) Fallback: búsqueda en drive personal + sharedWithMe
  const [myDriveRes, sharedRes] = await Promise.all([
    fetch(`https://graph.microsoft.com/v1.0/me/drive/search(q='BBDD Despachos')`, { headers }),
    fetch(`https://graph.microsoft.com/v1.0/me/drive/sharedWithMe`, { headers }),
  ]);

  let items: DriveItem[] = [];
  if (myDriveRes.ok) { const { value } = await myDriveRes.json() as { value: DriveItem[] }; items = [...items, ...value]; }
  if (sharedRes.ok)  { const { value } = await sharedRes.json()  as { value: DriveItem[] }; items = [...items, ...value]; }

  const item = items.find((f) => ONEDRIVE_FILE_NAMES.includes(f.name));
  if (!item) {
    const found = items.map((f) => f.name).slice(0, 5).join(", ") || "ninguno";
    const drivesDebug = driveNames.join(" | ") || "sin drives adicionales";
    const rootDebug = rootDebugItems.slice(0, 10).join(" | ") || "vacío";
    throw new Error(`Archivo no encontrado. Drives: [${drivesDebug}]. Raíz drive: [${rootDebug}]. Búsqueda: ${found}`);
  }

  return {
    url:          `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`,
    lastModified: item.lastModifiedDateTime ?? null,
  };
}

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
  // JS Date object (cuando se lee con cellDates: true)
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = val.getMonth() + 1;
    const d = val.getDate();
    if (isNaN(y)) return null;
    return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
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

  // Artículos Las Piedras — se importan todos, el cálculo de arena usa solo A36 y A39
  const ARTICULOS_LP = new Set(["A36LGC", "A37LGC", "A38LGC", "A39LGC"]);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Filtrar solo artículos de Las Piedras
    const articuloRaw = String(col(r,"Articulo","Artículo","ARTICULO","articulo","ItemCode") ?? "").trim().toUpperCase();
    if (!ARTICULOS_LP.has(articuloRaw)) { skipped.push(i + 2); continue; }

    const fechaRaw = col(r,"Fecha","fecha","FECHA");
    let fecha = parseExcelDate(fechaRaw);
    if (!fecha) { skipped.push(i + 2); continue; }

    const horaRaw = col(r,"Hora","hora","HORA");
    const hora = parseExcelTime(horaRaw) ?? "00:00";

    despachos.push({
      tipo:         String(col(r,"Tipo") ?? "").trim() || null,
      doc_entry:    parseNum(col(r,"DocEntry")),
      n_documento:  parseNum(col(r,"NDocumento","N° Documento")),
      folio:        parseNum(col(r,"Folio","FolioNum")),
      fecha,
      hora:         hora + ":00",
      fecha_hora:   `${fecha}T${hora}:00`,
      cliente:      String(col(r,"Cliente") ?? "").trim() || null,
      nombre:       String(col(r,"Nombre") ?? "").trim() || null,
      articulo:     articuloRaw || null,
      descripcion:  String(col(r,"Descripcion","Descripción") ?? "").trim() || null,
      toneladas:    parseNum(col(r,"Toneladas")),
      toneladas_confirmadas: parseNum(col(r,"ToneladasConfirmadas")),
      ton_final:    parseNum(col(r,"Neto")) ?? parseNum(col(r,"Toneladas")),
      precio:       parseNum(col(r,"Precio")),
      total:        parseNum(col(r,"Total")),
      patente:      String(col(r,"Patente") ?? "").trim().toUpperCase() || null,
      patente_acoplado: String(col(r,"PatenteAcoplado") ?? "").trim().toUpperCase() || null,
      rut_chofer:   String(col(r,"RUTChofer") ?? "").trim() || null,
    });
  }
  return { despachos, skipped };
}

async function upsertDespachos(despachos: Record<string, unknown>[]) {
  const sb = getSupabaseServer();
  const BATCH = 500;
  let total = 0;
  const errors: string[] = [];

  // Clave única SAP: doc_entry + articulo
  const withDocEntry    = despachos.filter((d) => d.doc_entry !== null);
  const withoutDocEntry = despachos.filter((d) => d.doc_entry === null);

  for (let i = 0; i < withDocEntry.length; i += BATCH) {
    const { error, count } = await sb
      .from("despachos")
      .upsert(withDocEntry.slice(i, i + BATCH), { onConflict: "doc_entry,articulo", ignoreDuplicates: true })
      .select("id", { count: "exact", head: true });
    if (error) errors.push(error.message);
    else total += count ?? 0;
  }
  for (let i = 0; i < withoutDocEntry.length; i += BATCH) {
    const { error, count } = await sb
      .from("despachos")
      .insert(withoutDocEntry.slice(i, i + BATCH))
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
  const sheetParam = searchParams.get("sheet") ?? "Consulta1";

  try {
    // Buscar y descargar BBDD Despachos.xlsx desde OneDrive / SharePoint
    let fileUrl: string;
    let fileLastModified: string | null = null;
    try {
      const info = await getOneDriveFileInfo(accessToken);
      fileUrl          = info.url;
      fileLastModified = info.lastModified;
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }

    const fileRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-cache" },
    });

    if (!fileRes.ok) {
      const err = await fileRes.text();
      return NextResponse.json(
        { error: `No se pudo descargar el archivo desde OneDrive (${fileRes.status}): ${err}` },
        { status: 502 }
      );
    }

    const buffer   = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

    const ws = workbook.Sheets[sheetParam] ?? workbook.Sheets[workbook.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({
        error: `Hoja "${sheetParam}" no encontrada. Hojas: ${workbook.SheetNames.join(", ")}`,
      }, { status: 400 });
    }

    const { despachos, skipped } = parseRows(ws);
    if (despachos.length === 0) {
      return NextResponse.json({
        synced: 0, skipped: skipped.length,
        message: `Sin filas válidas — ${skipped.length} filas omitidas. Verifica nombre de hoja y columnas.`,
      });
    }

    const { total, errors } = await upsertDespachos(despachos);

    const errMsg = errors.length ? ` | Errores: ${errors.slice(0, 2).join("; ")}` : "";

    const archivoFecha = fileLastModified
      ? new Date(fileLastModified).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })
      : "desconocida";

    return NextResponse.json({
      synced:            total,
      total_rows:        despachos.length,
      skipped:           skipped.length,
      file_last_modified: fileLastModified,
      sheets:            workbook.SheetNames,
      errors:            errors.length ? errors : undefined,
      message:           total === 0
        ? `Sin registros nuevos — archivo Excel modificado el ${archivoFecha} (${despachos.length} leídos, todos ya existían)`
        : `${total} despachos nuevos importados de ${despachos.length} leídos — archivo del ${archivoFecha}${errMsg}`,
    }, { status: errors.length && total === 0 ? 502 : 200 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET — debug: muestra hojas y primeras filas del archivo
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.rol !== "admin")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const accessToken = session.user.accessToken;
  if (!accessToken) return NextResponse.json({ error: "Sin token" }, { status: 401 });

  try {
    const fileUrl = await getOneDriveFileUrl(accessToken);
    const fileRes = await fetch(fileUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!fileRes.ok) return NextResponse.json({ error: `OneDrive ${fileRes.status}: ${await fileRes.text()}` }, { status: 502 });

    const buffer   = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const info: Record<string, { headers: string[]; rows: number; sample: unknown[] }> = {};

    for (const name of workbook.SheetNames) {
      const ws  = workbook.Sheets[name];
      const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
      info[name] = {
        headers: (all[0] ?? []).map(String),
        rows:    Math.max(0, all.length - 1),
        sample:  rows.slice(0, 2),
      };
    }
    return NextResponse.json({ sheets: workbook.SheetNames, info });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
