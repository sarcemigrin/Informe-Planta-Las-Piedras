"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState, useMemo } from "react";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase } from "@/lib/supabase";
import type { Despacho } from "@/types/database";
import { format, parseISO, startOfMonth } from "date-fns";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

const PER_PAGE = 10;
type Periodo = "mes" | "todo";

export default function DespachosPage() {
  const fileRef        = useRef<HTMLInputElement>(null);
  const [rows, setRows]       = useState<Despacho[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg]         = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);
  const [filtro, setFiltro]       = useState("");
  const [page, setPage]           = useState(1);
  const [periodo, setPeriodo]     = useState<Periodo>("mes");

  const [material, setMaterial]   = useState<string>("todos");

  useEffect(() => { loadDespachos(); }, []);

  async function loadDespachos() {
    const { data } = await supabase
      .from("despachos")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(2000);
    setRows(data ?? []);
  }

  // ---- Materiales únicos ----
  const materiales = useMemo(() => {
    const s = new Set(rows.map((r) => r.articulo).filter(Boolean) as string[]);
    return [...s].sort();
  }, [rows]);

  // ---- Dashboard: filtro por período + material ----
  const rowsFiltrados = useMemo(() => {
    const now    = new Date();
    const cutoff = periodo === "mes" ? startOfMonth(now) : null;

    return rows.filter((r) => {
      const pasaPeriodo  = !cutoff || (r.fecha_hora && parseISO(r.fecha_hora) >= cutoff);
      const pasaMaterial = material === "todos" || r.articulo === material;
      return pasaPeriodo && pasaMaterial;
    });
  }, [rows, periodo, material]);

  const totalTon        = rowsFiltrados.reduce((s, r) => s + (r.ton_final ?? 0), 0);
  const totalViajes     = rowsFiltrados.length;
  const promedioViaje   = totalViajes > 0 ? totalTon / totalViajes : 0;
  const diasActivos     = new Set(rowsFiltrados.map((r) => r.fecha)).size;
  const viajesPorDia    = diasActivos > 0 ? totalViajes / diasActivos : 0;

  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    rowsFiltrados.forEach((r) => {
      if (!r.fecha) return;
      map.set(r.fecha, (map.get(r.fecha) ?? 0) + (r.ton_final ?? 0));
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([fecha, ton]) => ({
        fecha: format(parseISO(fecha), "dd/MM"),
        ton:   Math.round(ton),
      }));
  }, [rowsFiltrados]);

  // ---- Tabla: filtro texto + material + paginación ----
  const filtered = rows.filter((r) => {
    const pasaMaterial = material === "todos" || r.articulo === material;
    const pasaTexto    = !filtro ||
      r.articulo?.toLowerCase().includes(filtro.toLowerCase()) ||
      r.nombre?.toLowerCase().includes(filtro.toLowerCase()) ||
      r.patente?.toLowerCase().includes(filtro.toLowerCase());
    return pasaMaterial && pasaTexto;
  });
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ---- Leer archivo Excel/CSV ----
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg({ type: "info", text: `Leyendo ${file.name}...` });

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(ev.target?.result, { type: "binary", cellDates: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
        setPreview(data.slice(0, 5));
        setMsg({ type: "info", text: `${data.length} filas leídas. Presiona "Importar" para subir.` });
        (fileRef.current as unknown as { _data: Record<string, unknown>[] })._data = data;
      } catch (err) {
        setMsg({ type: "err", text: `Error leyendo archivo: ${(err as Error).message}` });
      }
    };
    reader.readAsBinaryString(file);
  }

  async function handleImport() {
    const data: Record<string, unknown>[] | undefined =
      (fileRef.current as unknown as { _data?: Record<string, unknown>[] })?._data;
    if (!data || data.length === 0) { setMsg({ type: "err", text: "No hay datos cargados." }); return; }

    setUploading(true);
    setMsg({ type: "info", text: "Importando..." });
    let ok = 0, errors = 0;

    for (let i = 0; i < data.length; i += 500) {
      const lote = data.slice(i, i + 500).map((row) => {
        const fecha = parseExcelDate(row["Fecha"] ?? row["fecha"]);
        const hora  = parseExcelTime(row["Hora"]  ?? row["hora"]);
        const fh    = fecha && hora ? `${fecha}T${hora}:00+00:00` : null;

        return {
          tipo:                  String(row["Tipo"] ?? ""),
          doc_entry:             toInt(row["DocEntry"]),
          n_documento:           toInt(row["NDocumento"]),
          folio:                 toInt(row["Folio"]),
          fecha:                 fecha ?? "",
          hora:                  hora  ?? "00:00",
          fecha_hora:            fh    ?? "",
          cliente:               String(row["Cliente"]  ?? ""),
          nombre:                String(row["Nombre"]   ?? ""),
          articulo:              String(row["Articulo"] ?? ""),
          descripcion:           String(row["Descripcion"] ?? ""),
          toneladas:             toNum(row["Toneladas"]),
          toneladas_confirmadas: toNum(row["ToneladasConfirmadas"]),
          ton_final:             toNum(row["Ton. Final"]),
          precio:                toNum(row["Precio"]),
          total:                 toNum(row["Total"]),
          patente:               String(row["Patente"]           ?? ""),
          patente_acoplado:      String(row["PatenteAcoplado"]   ?? ""),
          rut_chofer:            String(row["RUTChofer"]         ?? ""),
          nombre_chofer:         String(row["NombreChofer"]      ?? ""),
          bodega_origen:         String(row["BodegaOrigen"]      ?? ""),
          bodega_destino:        String(row["BodegaDestino"]     ?? ""),
        };
      }).filter((r) => r.fecha && r.fecha_hora);

      const { error } = await supabase.from("despachos").upsert(lote, { onConflict: "doc_entry" });
      if (error) { errors += lote.length; }
      else       { ok     += lote.length; }
      setMsg({ type: "info", text: `Procesando... ${i + lote.length}/${data.length}` });
    }

    setMsg({
      type: errors > 0 ? "err" : "ok",
      text: `Importación completa: ${ok} ok, ${errors} con error.`,
    });
    await loadDespachos();
    setUploading(false);
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Despachos</h1>
        <p className="text-sm text-gray-500">
          Equivalente a Query1. Importa el archivo Excel/CSV exportado de tu ERP.
        </p>
      </div>

      {/* ---- Dashboard ---- */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-gray-700">Resumen</h2>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Filtro período */}
            <div className="flex gap-0.5 border border-gray-200 rounded-full p-0.5">
              {(["mes", "todo"] as Periodo[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriodo(p)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    periodo === p
                      ? "bg-green-100 text-migrin-dark"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {p === "mes" ? "Mes" : "Todo"}
                </button>
              ))}
            </div>
            {/* Filtro material */}
            <div className="flex gap-0.5 border border-gray-200 rounded-full p-0.5">
              {(["todos", ...materiales]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMaterial(m); setPage(1); }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    material === m
                      ? "bg-orange-100 text-migrin-dark"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "todos" ? "Todos" : m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="stat-card text-center">
            <span className="stat-label">Total despachado</span>
            <div className="flex items-baseline justify-center gap-1">
              <span className="stat-value">{totalTon.toLocaleString("es-CL", { maximumFractionDigits: 0 })}</span>
              <span className="text-xs text-gray-400">ton</span>
            </div>
          </div>
          <div className="stat-card text-center">
            <span className="stat-label">Total viajes</span>
            <div className="flex items-baseline justify-center gap-1">
              <span className="stat-value">{totalViajes.toLocaleString("es-CL")}</span>
              <span className="text-xs text-gray-400">viajes</span>
            </div>
          </div>
          <div className="stat-card text-center">
            <span className="stat-label">Promedio / viaje</span>
            <div className="flex items-baseline justify-center gap-1">
              <span className="stat-value">{promedioViaje.toLocaleString("es-CL", { maximumFractionDigits: 1 })}</span>
              <span className="text-xs text-gray-400">ton</span>
            </div>
          </div>
          <div className="stat-card text-center">
            <span className="stat-label">Despachos / día</span>
            <div className="flex items-baseline justify-center gap-1">
              <span className="stat-value">{viajesPorDia.toLocaleString("es-CL", { maximumFractionDigits: 1 })}</span>
              <span className="text-xs text-gray-400">viajes</span>
            </div>
          </div>
        </div>

        {chartData.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-2">Ton despachadas por día</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => `${(v as number).toLocaleString("es-CL")} ton`} />
                <Bar dataKey="ton" name="Ton" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ---- Tabla historial ---- */}
      <div className="card overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-gray-800">
            Historial ({filtered.length.toLocaleString("es-CL")} registros)
          </h2>
          <input
            className="input w-48"
            placeholder="Filtrar..."
            value={filtro}
            onChange={(e) => { setFiltro(e.target.value); setPage(1); }}
          />
        </div>

        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha y hora</th>
              <th className="table-th text-left">Artículo</th>
              <th className="table-th text-left">Cliente</th>
              <th className="table-th">Ton Final</th>
              <th className="table-th text-left">Patente</th>
              <th className="table-th text-left">Bodega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paginated.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="table-td-left">{r.fecha} {r.hora?.slice(0, 5)}</td>
                <td className="table-td-left">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                    r.articulo === "A36LGC" ? "bg-orange-100 text-migrin-dark" :
                    r.articulo === "A37LGC" ? "bg-blue-100 text-blue-700"     :
                                              "bg-gray-100 text-gray-600"
                  }`}>{r.articulo}</span>
                </td>
                <td className="table-td-left text-gray-600 truncate max-w-[180px]">{r.nombre}</td>
                <td className="table-td font-semibold">{r.ton_final?.toFixed(2)}</td>
                <td className="table-td-left">{r.patente}</td>
                <td className="table-td-left text-gray-400">{r.bodega_origen}</td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={6} className="table-td text-gray-400 py-8 text-center">Sin registros</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-400">
            {filtered.length > 0
              ? `Mostrando ${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, filtered.length)} de ${filtered.length.toLocaleString("es-CL")}`
              : "Sin registros"}
          </span>
          <div className="flex gap-2">
            <button
              className="btn-secondary text-xs py-1 px-3"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >← Anterior</button>
            <button
              className="btn-secondary text-xs py-1 px-3"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >Siguiente →</button>
          </div>
        </div>
      </div>

      {/* ---- Importar ---- */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-700">Importar archivo de despachos</h2>
        <p className="text-xs text-gray-500">
          El archivo debe tener las columnas del sistema ERP:
          Tipo, DocEntry, NDocumento, Folio, Fecha, Hora, Articulo, Toneladas, Ton. Final, Patente, etc.
        </p>

        <div className="flex flex-wrap gap-3 items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-migrin-dark hover:file:bg-orange-100"
            onChange={handleFile}
          />
          <button className="btn-primary" onClick={handleImport} disabled={uploading}>
            {uploading ? "Importando..." : "Importar →"}
          </button>
        </div>

        {msg && (
          <div className={`rounded-lg px-4 py-3 text-sm ${
            msg.type === "ok"  ? "bg-green-50 text-green-700"  :
            msg.type === "err" ? "bg-red-50 text-red-700"      :
                                 "bg-blue-50 text-blue-700"
          }`}>{msg.text}</div>
        )}

        {preview.length > 0 && (
          <div className="overflow-auto">
            <p className="text-xs font-semibold text-gray-500 mb-1">Vista previa (primeras 5 filas):</p>
            <table className="text-xs border-collapse">
              <thead>
                <tr>{Object.keys(preview[0]).map((k) => (
                  <th key={k} className="border border-gray-200 px-2 py-1 bg-gray-50 whitespace-nowrap">{k}</th>
                ))}</tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="border border-gray-200 px-2 py-1 whitespace-nowrap">
                        {String(v ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </AdminGuard>
  );
}

// ---- Helpers de parseo ----
function parseExcelDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return format(v, "yyyy-MM-dd");
  if (typeof v === "string") {
    const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const parts = v.split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400 * 1000);
    return format(d, "yyyy-MM-dd");
  }
  return null;
}

function parseExcelTime(v: unknown): string | null {
  if (!v) return "00:00";
  if (v instanceof Date) return format(v, "HH:mm");
  if (typeof v === "string") {
    const m = v.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  if (typeof v === "number") {
    const totalMin = Math.round(v * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return "00:00";
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = parseInt(String(v));
  return isNaN(n) ? null : n;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
