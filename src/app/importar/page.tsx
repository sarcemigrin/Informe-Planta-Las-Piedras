"use client";

export const dynamic = "force-dynamic";

/**
 * Página de importación del Excel histórico.
 * Sube los datos de las hojas "Datos Arena" y "Datos Cuarzo"
 * al Supabase para usarlos como base histórica.
 */

import { useRef, useState } from "react";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import { format } from "date-fns";

interface Progreso {
  etapa:  string;
  ok:     number;
  err:    number;
  total:  number;
}

export default function ImportarPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [log, setLog]           = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);

  function addLog(msg: string) {
    setLog((l) => [...l, msg]);
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) { addLog("❌ Selecciona un archivo Excel"); return; }

    setLoading(true);
    setLog([]);
    setProgreso(null);
    addLog(`📂 Leyendo ${file.name}...`);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary", cellDates: true });

        // ---- IMPORTAR DATOS ARENA ----
        addLog("⛏ Importando hoja 'Datos Arena'...");
        const wsArena = wb.Sheets["Datos Arena"];
        if (!wsArena) {
          addLog("⚠ No se encontró la hoja 'Datos Arena'");
        } else {
          await importArena(wsArena);
        }

        // ---- IMPORTAR DATOS CUARZO ----
        addLog("🪨 Importando hoja 'Datos Cuarzo'...");
        const wsCuarzo = wb.Sheets["Datos Cuarzo"];
        if (!wsCuarzo) {
          addLog("⚠ No se encontró la hoja 'Datos Cuarzo'");
        } else {
          await importCuarzo(wsCuarzo);
        }

        // ---- IMPORTAR QUERY1 / DESPACHOS ----
        addLog("🚛 Importando hoja 'Query1' (despachos)...");
        const wsQuery = wb.Sheets["Query1"];
        if (!wsQuery) {
          addLog("⚠ No se encontró la hoja 'Query1'");
        } else {
          await importDespachos(wsQuery);
        }

        addLog("✅ Importación completa");
      } catch (e: unknown) {
        addLog(`❌ Error: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  }

  async function importArena(ws: XLSX.WorkSheet) {
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      header: "A", defval: null, range: 2, // saltar la fila de encabezados
    });

    const rows = raw.filter((r) => r["A"] instanceof Date || typeof r["A"] === "string");
    addLog(`  → ${rows.length} filas encontradas`);

    let ok = 0, err = 0;
    const lote: Record<string,unknown>[] = [];

    for (const r of rows) {
      const fecha = parseDate(r["A"]);
      const hora  = parseTime(r["B"]);
      if (!fecha || !hora) continue;

      const fechaHora = new Date(`${fecha}T${hora}:00`).toISOString();

      lote.push({
        fecha,
        hora:       hora + ":00",
        fecha_hora: fechaHora,
        pesometro:  toNum(r["D"]),
        horometro:  toNum(r["G"]),
        fierrillo:  toNum(r["L"]) ?? 0,
        cono_1:     toNum(r["S"]) ?? 0,
        cono_2:     toNum(r["T"]) ?? 0,
        cono_3:     toNum(r["U"]) ?? 0,
        pila_1:     toNum(r["V"]) ?? 0,
        pila_2:     toNum(r["W"]) ?? 0,
        pila_3:     toNum(r["X"]) ?? 0,
        pila_4:     toNum(r["Y"]) ?? 0,
        pila_5:     toNum(r["Z"]) ?? 0,
        pila_6:     toNum(r["AA"]) ?? 0,
        pila_7:     toNum(r["AB"]) ?? 0,
        // Valores calculados del Excel (importar como referencia histórica)
        diferencia_pesometro:     toNum(r["E"]),
        produccion_pesometro:     toNum(r["F"]),
        diferencia_horometro:     toNum(r["H"]),
        horas_reales:             toNum(r["I"]),
        detencion:                toNum(r["J"]),
        despachos_ton:            toNum(r["M"]),
        cantidad_despachos:       toNum(r["N"]),
        conos:                    toNum(r["AD"]),
        acopio:                   toNum(r["AE"]),
        inventario_m3:            toNum(r["AF"]),
        inventario_ton:           toNum(r["AG"]),
        diferencia_inventario:    toNum(r["AH"]),
        produccion_drone:         toNum(r["AN"]),
        productividad_drone:      toNum(r["AO"]),
        productividad_pesometro:  toNum(r["AK"]),
        productividad_hrs_reales: toNum(r["AP"]),
        diferencia:               toNum(r["AQ"]),
        cancha_vieja_ton:         toNum(r["AR"]),
        cancha_nueva_ton:         toNum(r["AS"]),
      });

      if (lote.length >= 100) {
        const { error } = await supabase.from("registros_arena")
          .upsert(lote as never[], { onConflict: "fecha_hora" });
        if (error) { err += lote.length; addLog(`  ⚠ Lote con error: ${error.message}`); }
        else        { ok  += lote.length; }
        lote.length = 0;
        setProgreso({ etapa:"Arena", ok, err, total: rows.length });
      }
    }

    // Último lote
    if (lote.length > 0) {
      const { error } = await supabase.from("registros_arena")
        .upsert(lote as never[], { onConflict: "fecha_hora" });
      if (error) { err += lote.length; }
      else        { ok  += lote.length; }
    }

    addLog(`  ✅ Arena: ${ok} importados, ${err} errores`);
    setProgreso({ etapa:"Arena", ok, err, total: rows.length });
  }

  async function importCuarzo(ws: XLSX.WorkSheet) {
    const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(ws, {
      header: "A", defval: null, range: 2,
    });

    const rows = raw.filter((r) => r["A"] instanceof Date || typeof r["A"] === "string");
    addLog(`  → ${rows.length} filas encontradas`);
    let ok = 0, err = 0;
    const lote: Record<string,unknown>[] = [];

    for (const r of rows) {
      const fecha = parseDate(r["A"]);
      const hora  = parseTime(r["B"]);
      if (!fecha || !hora) continue;

      lote.push({
        fecha,
        hora:       hora + ":00",
        fecha_hora: new Date(`${fecha}T${hora}:00`).toISOString(),
        pesometro:  toNum(r["D"]),
        horometro:  toNum(r["G"]),
        cono_1:     toNum(r["M"]) ?? 0,
        cono_2:     toNum(r["N"]) ?? 0,
        cono_3:     toNum(r["O"]) ?? 0,
        diferencia_pesometro:    toNum(r["E"]),
        produccion_pesometro:    toNum(r["F"]),
        diferencia_horometro:    toNum(r["H"]),
        horas_reales:            toNum(r["I"]),
        detencion:               toNum(r["J"]),
        despachos_ton:           toNum(r["K"]),
        cantidad_despachos:      toNum(r["L"]),
        conos:                   toNum(r["P"]),
        inventario_m3:           toNum(r["Q"]),
        inventario_ton:          toNum(r["R"]),
        diferencia_inventario:   toNum(r["S"]),
        produccion_drone:        toNum(r["V"]),
        productividad_drone:     toNum(r["W"]),
        productividad_pesometro: toNum(r["U"]),
        productividad_hrs_reales:toNum(r["X"]),
        diferencia:              toNum(r["Y"]),
      });

      if (lote.length >= 100) {
        const dedup = Object.values(lote.reduce((acc, row) => { acc[row.fecha_hora as string] = row; return acc; }, {} as Record<string, Record<string,unknown>>));
        const { error } = await supabase.from("registros_cuarzo").upsert(dedup as never[], { onConflict: "fecha_hora" });
        if (error) { err += lote.length; addLog(`  ⚠ Cuarzo error: ${error.message}`); }
        else ok += dedup.length;
        lote.length = 0;
        setProgreso({ etapa:"Cuarzo", ok, err, total: rows.length });
      }
    }

    if (lote.length > 0) {
      const dedup = Object.values(lote.reduce((acc, row) => { acc[row.fecha_hora as string] = row; return acc; }, {} as Record<string, Record<string,unknown>>));
      const { error } = await supabase.from("registros_cuarzo").upsert(dedup as never[], { onConflict: "fecha_hora" });
      if (error) { err += lote.length; addLog(`  ⚠ Último lote cuarzo: ${error.message}`); }
      else ok += dedup.length;
    }
    addLog(`  ✅ Cuarzo: ${ok} importados, ${err} errores`);
  }

  async function importDespachos(ws: XLSX.WorkSheet) {
    const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(ws, {
      defval: null, header: 1,
    }) as unknown[][];

    // Primera fila = headers
    const headers = raw[0] as string[];
    const data    = raw.slice(1);
    addLog(`  → ${data.length} filas encontradas`);

    let ok = 0, err = 0;
    const lote: Record<string,unknown>[] = [];

    for (const rowArr of data) {
      const row: Record<string,unknown> = {};
      headers.forEach((h, i) => { row[h] = rowArr[i]; });

      const fecha = parseDate(row["Fecha"]);
      const hora  = parseTime(row["Hora"]);
      if (!fecha) continue;

      const fh = fecha && hora ? `${fecha}T${hora}:00+00:00` : null;

      lote.push({
        tipo:                  String(row["Tipo"] ?? ""),
        doc_entry:             toInt(row["DocEntry"]),
        n_documento:           toInt(row["NDocumento"]),
        folio:                 toInt(row["Folio"]),
        fecha,
        hora:                  (hora ?? "00:00") + ":00",
        fecha_hora:            fh ?? `${fecha}T00:00:00+00:00`,
        cliente:               String(row["Cliente"] ?? ""),
        nombre:                String(row["Nombre"]  ?? ""),
        articulo:              String(row["Articulo"] ?? ""),
        descripcion:           String(row["Descripcion"] ?? ""),
        toneladas:             toNum(row["Toneladas"]),
        toneladas_confirmadas: toNum(row["ToneladasConfirmadas"]),
        ton_final:             toNum(row["Ton. Final"]),
        precio:                toNum(row["Precio"]),
        total:                 toNum(row["Total"]),
        patente:               String(row["Patente"]          ?? ""),
        patente_acoplado:      String(row["PatenteAcoplado"]  ?? ""),
        rut_chofer:            String(row["RUTChofer"]        ?? ""),
        nombre_chofer:         String(row["NombreChofer"]     ?? ""),
        bodega_origen:         String(row["BodegaOrigen"]     ?? ""),
        bodega_destino:        String(row["BodegaDestino"]    ?? ""),
      });

      if (lote.length >= 500) {
        const { error } = await supabase.from("despachos").insert(lote);
        if (error) {
          err += lote.length;
          if (err <= 500) addLog(`  ⚠ Error (lote): ${error.message}`);
        } else ok += lote.length;
        lote.length = 0;
        setProgreso({ etapa:"Despachos", ok, err, total: data.length });
      }
    }

    if (lote.length > 0) {
      const { error } = await supabase.from("despachos").insert(lote);
      if (error) { err += lote.length; addLog(`  ⚠ Error (último lote): ${error.message}`); }
      else       ok  += lote.length;
    }

    // --- Diagnóstico: si todo falla, intenta insertar solo 1 fila ---
    if (ok === 0 && err > 0 && data.length > 0) {
      addLog("  🔍 Diagnóstico: intentando insertar 1 fila...");
      const firstRow = data[0] as unknown[];
      const rowObj: Record<string,unknown> = {};
      headers.forEach((h, i) => { rowObj[h] = firstRow[i]; });
      addLog(`  📋 Headers del Excel: ${headers.slice(0,10).join(" | ")}`);
      const fecha0 = parseDate(rowObj["Fecha"]);
      const hora0  = parseTime(rowObj["Hora"]);
      addLog(`  📋 Fecha: ${fecha0}, Hora: ${hora0}`);
      const { error: e1 } = await supabase.from("despachos").insert([{
        fecha: fecha0,
        hora: (hora0 ?? "00:00") + ":00",
        fecha_hora: `${fecha0}T${hora0 ?? "00:00"}:00+00:00`,
        tipo: String(rowObj["Tipo"] ?? ""),
      }]);
      if (e1) addLog(`  ❌ Error 1 fila: ${e1.message} | code: ${e1.code} | details: ${e1.details}`);
      else addLog("  ✅ 1 fila insertada OK");
    }

    addLog(`  ✅ Despachos: ${ok} importados, ${err} errores`);
    setProgreso({ etapa:"Despachos", ok, err, total: data.length });
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">⬆ Importar Excel histórico</h1>
        <p className="text-sm text-gray-500">
          Sube tu archivo "Informe Producción Planta Arena" para cargar todo el historial en Supabase.
          Esto solo se necesita hacer una vez para migrar la data existente.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-700">📂 Seleccionar archivo Excel</h2>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>✅ Se importarán las hojas: <strong>Datos Arena</strong>, <strong>Datos Cuarzo</strong> y <strong>Query1</strong></li>
          <li>✅ Si ya hay datos en Supabase, se actualizarán (upsert por fecha_hora / doc_entry)</li>
          <li>✅ El archivo no se modifica, solo se lee</li>
          <li>⚠ La importación puede tardar varios minutos con archivos grandes</li>
        </ul>

        <div className="flex flex-wrap gap-3 items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-migrin-dark hover:file:bg-orange-100"
          />
          <button
            className="btn-primary"
            onClick={handleImport}
            disabled={loading}
          >
            {loading ? "Importando..." : "🚀 Iniciar importación"}
          </button>
        </div>

        {/* Progreso */}
        {progreso && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm font-semibold text-gray-700 mb-1">{progreso.etapa}</p>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
              <div
                className="bg-migrin h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, (progreso.ok / Math.max(progreso.total, 1)) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {progreso.ok} / {progreso.total} · {progreso.err} errores
            </p>
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 space-y-1 max-h-64 overflow-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      {/* Instrucciones posteriores */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-700">¿Qué hacer después?</h2>
        <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
          <li>Verifica en <strong>Dashboard</strong> que los datos aparecen correctamente</li>
          <li>Revisa en <strong>Informe</strong> que los totales coinciden con tu Excel</li>
          <li>De ahora en adelante, ingresa cada droneo desde la página <strong>Arena</strong> o <strong>Cuarzo</strong></li>
          <li>Cuando tengas nuevos despachos del ERP, importa el CSV desde la página <strong>Despachos</strong></li>
        </ol>
      </div>
    </div>
    </AdminGuard>
  );
}

// ---- Helpers ----
function parseDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return format(v, "yyyy-MM-dd");
  if (typeof v === "string") {
    const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const parts = v.split("/");
    if (parts.length === 3) {
      const [d,mo,y] = parts;
      return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`;
    }
  }
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400 * 1000);
    return format(d, "yyyy-MM-dd");
  }
  return null;
}

function parseTime(v: unknown): string | null {
  if (!v) return "00:00";
  if (v instanceof Date) return format(v, "HH:mm");
  if (typeof v === "string") {
    const m = v.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2,"0")}:${m[2]}`;
  }
  if (typeof v === "number") {
    const totalMin = Math.round(v * 24 * 60);
    return `${String(Math.floor(totalMin/60)%24).padStart(2,"0")}:${String(totalMin%60).padStart(2,"0")}`;
  }
  return "00:00";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = parseInt(String(v)