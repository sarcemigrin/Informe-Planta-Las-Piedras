"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena } from "@/types/database";
import { format, getISOWeek, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import {
  ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
  Cell,
} from "recharts";
import { EditArenaModal } from "@/components/EditArenaModal";

// ─── Paleta corporativa ───────────────────────────────────────────────────────
const C_DRONE   = "#6BCF7F";
const C_PESO    = "#374151";
const C_INV     = "#94a3b8";
const C_SELECTED = "#6BCF7F22";  // fondo fila seleccionada

// ─── Umbrales ─────────────────────────────────────────────────────────────────
const PROD_TARGET = 32;
const INV_TARGET  = 7500;
const INV_WARN    = 6500;
const CUB_INIT    = 15;
const CUB_STEP    = 10;

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface HistorialCambio {
  id: string; campo: string;
  valor_anterior: string; valor_nuevo: string;
  usuario_email: string; created_at: string; registro_id: string;
}
interface SemanaStat {
  semana: string;
  prodDrone: number; prodPeso: number;
  despachos: number; viajes: number;
  dias: number; hrsProd: number; detencion: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function prodColor(v?: number | null) {
  if (!v) return "text-gray-700";
  return v >= PROD_TARGET ? "text-green-600" : v >= PROD_TARGET * 0.9 ? "text-yellow-500" : "text-red-500";
}
function invColor(v?: number | null) {
  if (!v) return "text-gray-700";
  return v >= INV_TARGET ? "text-green-600" : v >= INV_WARN ? "text-yellow-500" : "text-red-500";
}
function difBadge(dif?: number | null) {
  if (dif == null) return { bg: "bg-gray-100", text: "text-gray-500", label: "–" };
  const pct = (dif * 100).toFixed(1) + "%";
  if (dif > 0.1)  return { bg: "bg-red-100",   text: "text-red-700",   label: pct };
  if (dif < -0.1) return { bg: "bg-green-100", text: "text-green-700", label: pct };
  return { bg: "bg-gray-100", text: "text-gray-600", label: pct };
}

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="w-1 h-5 rounded-full" style={{ backgroundColor: C_DRONE }} />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-600">{title}</h2>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
      {action}
    </div>
  );
}

function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${color ?? "text-gray-800"}`}>{value}</p>
    </div>
  );
}

// Panel de datos sobre el gráfico (registro seleccionado)
function InfoPanel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="card mb-3 py-3 border-l-4" style={{ borderLeftColor: C_DRONE }}>
      <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
        {children}
      </div>
      {hint && <p className="text-xs text-gray-400 mt-2">{hint}</p>}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function InformePage() {
  const { data: session } = useSession();
  const isAdmin           = session?.user?.rol === "admin";

  const [rows, setRows]               = useState<RegistroArena[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editRow, setEditRow]         = useState<RegistroArena | null>(null);
  const [historial, setHistorial]     = useState<HistorialCambio[]>([]);
  const [showHistorial, setShowHistorial] = useState(false);

  // Cubicación
  const [cubLimit, setCubLimit]       = useState(CUB_INIT);
  const [selectedCubId, setSelectedCubId] = useState<string | null>(null);

  // Semanal
  const [semAnios,    setSemAnios]    = useState<number[]>([]);
  const [semSemestre, setSemSemestre] = useState<"todo" | "S1" | "S2">("todo");
  const [selectedSemKey, setSelectedSemKey] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: true });
    const loaded = data ?? [];
    setRows(loaded);
    setLoading(false);
    if (semAnios.length === 0) setSemAnios([new Date().getFullYear()]);
    // Selección inicial = último registro
    if (loaded.length > 0) setSelectedCubId(loaded[loaded.length - 1].id);
  }

  async function loadHistorial() {
    const { data } = await supabase
      .from("historial_cambios")
      .select("*")
      .eq("tabla", "registros_arena")
      .order("created_at", { ascending: false })
      .limit(100);
    setHistorial(data ?? []);
  }

  // ── Último registro ───────────────────────────────────────────────────────
  const ultimoRow = rows.length > 0 ? rows[rows.length - 1] : null;

  // ── Cubicación: datos dinámicos según cubLimit ────────────────────────────
  const cubRows    = rows.slice(-cubLimit);
  const avgProdKpi = cubRows.reduce((s, r) => s + (r.productividad_drone ?? 0), 0) / (cubRows.length || 1);

  const chartCubicacion = cubRows.map((r) => ({
    _id:        r.id,
    fecha:      format(parseISO(r.fecha), "dd/MM"),
    kpiDrone:   r.productividad_drone   ?? null,
    kpiPeso:    r.productividad_pesometro ?? null,
    inventario: r.inventario_ton         ?? null,
  }));

  // Registro cubicación seleccionado (por defecto el último)
  const selectedCubRow = (selectedCubId ? rows.find(r => r.id === selectedCubId) : null) ?? ultimoRow;

  // ── Semanal ───────────────────────────────────────────────────────────────
  const semanas: Record<string, SemanaStat> = {};
  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = rows[i - 1];
    const anio = parseISO(r.fecha).getFullYear();
    const sem  = `${anio}-S${String(getISOWeek(parseISO(r.fecha))).padStart(2, "0")}`;
    const dias = Math.max(1, Math.round((new Date(r.fecha).getTime() - new Date(prev.fecha).getTime()) / 86400000));
    if (!semanas[sem]) semanas[sem] = { semana: sem, prodDrone: 0, prodPeso: 0, despachos: 0, viajes: 0, dias: 0, hrsProd: 0, detencion: 0 };
    semanas[sem].prodDrone  += r.produccion_drone      ?? 0;
    semanas[sem].prodPeso   += r.produccion_pesometro  ?? 0;
    semanas[sem].despachos  += r.despachos_ton         ?? 0;
    semanas[sem].viajes     += r.cantidad_despachos    ?? 0;
    semanas[sem].dias       += dias;
    semanas[sem].hrsProd    += r.diferencia_horometro  ?? 0;
    semanas[sem].detencion  += r.detencion             ?? 0;
  }
  const semanalRows      = Object.values(semanas).sort((a, b) => a.semana.localeCompare(b.semana));
  const anioActual       = new Date().getFullYear();
  const aniosDisponibles = [...new Set(semanalRows.map(s => parseInt(s.semana.split("-")[0])))].sort();

  const S1 = Array.from({ length: 26 }, (_, i) => String(i +  1).padStart(2, "0"));
  const S2 = Array.from({ length: 26 }, (_, i) => String(i + 27).padStart(2, "0"));

  const semanalFiltradas = semanalRows.filter(s => {
    const [aStr, wStr] = s.semana.split("-S");
    if (!semAnios.includes(parseInt(aStr))) return false;
    if (semSemestre === "S1" && !S1.includes(wStr)) return false;
    if (semSemestre === "S2" && !S2.includes(wStr)) return false;
    return true;
  });

  const soloUnAnio   = semAnios.length === 1;
  const chartSemanal = semanalFiltradas.map(s => ({
    _key:     s.semana,
    semana:   soloUnAnio ? s.semana.replace(`${semAnios[0]}-`, "") : s.semana,
    kpiDrone: s.hrsProd > 0 ? +(s.prodDrone / s.hrsProd).toFixed(2) : null,
    kpiPeso:  s.hrsProd > 0 ? +(s.prodPeso  / s.hrsProd).toFixed(2) : null,
  }));

  // Semana seleccionada (por defecto la última del filtro)
  const lastSemFiltrada   = semanalFiltradas[semanalFiltradas.length - 1] ?? null;
  const selectedSem       = (selectedSemKey ? semanalFiltradas.find(s => s.semana === selectedSemKey) : null) ?? lastSemFiltrada;
  const selectedSemKpiD   = selectedSem && selectedSem.hrsProd > 0 ? selectedSem.prodDrone / selectedSem.hrsProd : 0;
  const selectedSemKpiP   = selectedSem && selectedSem.hrsProd > 0 ? selectedSem.prodPeso  / selectedSem.hrsProd : 0;
  const selectedSemDetPct = selectedSem && (selectedSem.hrsProd + selectedSem.detencion) > 0
    ? selectedSem.detencion / (selectedSem.hrsProd + selectedSem.detencion) * 100 : 0;

  // ── Excel ─────────────────────────────────────────────────────────────────
  function exportExcel() {
    const dataCub = rows.map(r => ({
      "Fecha y hora":              r.fecha_hora ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm") : "",
      "Horas Productivas":         r.diferencia_horometro ?? "",
      "Detención (hrs)":           r.detencion ?? "",
      "Despachos (Viajes)":        r.cantidad_despachos ?? "",
      "Despachos (Ton)":           r.despachos_ton ?? "",
      "Producción (Pesómetro)":    r.produccion_pesometro ?? "",
      "Productividad (Pesómetro)": r.productividad_pesometro ?? "",
      "Producción (Drone)":        r.produccion_drone ?? "",
      "Productividad (Drone)":     r.productividad_drone ?? "",
      "Inventario (Ton)":          r.inventario_ton ?? "",
      "Diferencia":                r.diferencia ? (r.diferencia * 100).toFixed(1) + "%" : "",
    }));
    const dataSem = semanalRows.map(s => ({
      "Semana":                s.semana,
      "Hrs Productivas":       s.hrsProd.toFixed(1),
      "Detención (hrs)":       s.detencion.toFixed(1),
      "Despachos (Ton)":       s.despachos.toFixed(2),
      "Despachos (Viajes)":    s.viajes,
      "Producción Pesóm.":     s.prodPeso.toFixed(2),
      "Productividad Pesóm.":  s.hrsProd > 0 ? (s.prodPeso / s.hrsProd).toFixed(2) : "",
      "Producción Drone":      s.prodDrone.toFixed(2),
      "Productividad Drone":   s.hrsProd > 0 ? (s.prodDrone / s.hrsProd).toFixed(2) : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataCub), "Por Cubicación");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataSem), "Por Semana");
    XLSX.writeFile(wb, `Informe_Arena_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Cargando...</div>;

  return (
    <>
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informe Producción Arena</h1>
          <p className="text-sm text-gray-500">
            {rows.length > 0
              ? <>Del {format(parseISO(rows[0].fecha), "dd/MM/yyyy")} al {format(parseISO(rows[rows.length-1].fecha), "dd/MM/yyyy")} · {rows.length} cubicaciones</>
              : "Sin datos"}
          </p>
        </div>
        <button className="btn-secondary" onClick={exportExcel}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exportar Excel
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECCIÓN 1 — POR CUBICACIÓN
      ══════════════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader title="Por Cubicación" sub={`últimos ${cubRows.length} registros`} />

        {/* Panel del registro seleccionado */}
        {selectedCubRow && (
          <InfoPanel hint="Pincha un punto del gráfico o una fila de la tabla para ver su detalle">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Último droneo</p>
              <p className="text-sm font-semibold text-gray-900">
                {format(parseISO(selectedCubRow.fecha), "dd 'de' MMMM yyyy", { locale: es })}
                {selectedCubRow.hora && <span className="text-gray-400 font-normal ml-1">· {selectedCubRow.hora.slice(0,5)}</span>}
              </p>
            </div>
            <StatMini label="Producción Drone"    value={`${fmt(selectedCubRow.produccion_drone)} ton`}         color={prodColor(selectedCubRow.productividad_drone)} />
            <StatMini label="Productividad Drone" value={`${fmt(selectedCubRow.productividad_drone)} t/h`}      color={prodColor(selectedCubRow.productividad_drone)} />
            <StatMini label="Producción Pesóm."   value={`${fmt(selectedCubRow.produccion_pesometro)} ton`} />
            <StatMini label="Productividad Pesóm." value={`${fmt(selectedCubRow.productividad_pesometro)} t/h`} />
            <StatMini label="Despachos"           value={`${fmt(selectedCubRow.despachos_ton)} ton · ${selectedCubRow.cantidad_despachos ?? 0} vj`} />
            <StatMini label="Inventario"          value={`${fmt(selectedCubRow.inventario_ton)} ton`}           color={invColor(selectedCubRow.inventario_ton)} />
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Diferencia</p>
              {(() => { const b = difBadge(selectedCubRow.diferencia); return (
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold ${b.bg} ${b.text}`}>{b.label}</span>
              );})()}
            </div>
          </InfoPanel>
        )}

        {/* Gráfico — productividad Drone + Pesóm. (izq.), inventario (der.) */}
        {chartCubicacion.length > 0 && (
          <div className="card mb-4 cursor-pointer">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={chartCubicacion}
                margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
                onClick={(data) => {
                  if (!data?.activePayload?.[0]) return;
                  const id = (data.activePayload[0].payload as { _id: string })._id;
                  setSelectedCubId(id);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="kpi"
                  tick={{ fontSize: 10 }}
                  label={{ value: "t/h", angle: -90, position: "insideLeft", offset: -2, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <YAxis
                  yAxisId="inv"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  label={{ value: "ton", angle: 90, position: "insideRight", offset: 12, style: { fontSize: 9, fill: C_INV } }}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const isInv = name === "Inventario";
                    return [`${fmt(value as number)} ${isInv ? "ton" : "t/h"}`, name];
                  }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Legend />
                <ReferenceLine
                  yAxisId="kpi" y={avgProdKpi} stroke={C_DRONE} strokeDasharray="5 5"
                  label={{ value: `Prom. ${fmt(avgProdKpi)} t/h`, fill: C_DRONE, fontSize: 9 }}
                />
                <Line yAxisId="kpi" type="monotone" dataKey="kpiDrone"   name="Productividad Drone"  stroke={C_DRONE} strokeWidth={2.5} dot={{ r: 3, fill: C_DRONE, strokeWidth: 0 }} connectNulls activeDot={{ r: 6, fill: C_DRONE }} />
                <Line yAxisId="kpi" type="monotone" dataKey="kpiPeso"    name="Productividad Pesóm." stroke={C_PESO}  strokeWidth={2.5} dot={{ r: 3, fill: C_PESO,  strokeWidth: 0 }} connectNulls activeDot={{ r: 6, fill: C_PESO  }} />
                <Line yAxisId="inv" type="monotone" dataKey="inventario" name="Inventario"            stroke={C_INV}  strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabla con paginación */}
        {(() => {
          const reversed = [...rows].reverse();
          const visible  = reversed.slice(0, cubLimit);
          const hayMas   = cubLimit < reversed.length;
          const hayMenos = cubLimit > CUB_INIT;
          return (
            <div className="card overflow-auto p-0">
              <table className="w-full min-w-[1020px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="table-th text-left">Fecha y Hora</th>
                    <th className="table-th">Productividad Drone</th>
                    <th className="table-th">Producción Drone</th>
                    <th className="table-th">Horas Prod.</th>
                    <th className="table-th">Detención</th>
                    <th className="table-th">Productividad Pesóm.</th>
                    <th className="table-th">Producción Pesóm.</th>
                    <th className="table-th">Viajes</th>
                    <th className="table-th">Despachos (ton)</th>
                    <th className="table-th">Productividad Real</th>
                    <th className="table-th">Inventario</th>
                    <th className="table-th">Diferencia</th>
                    {isAdmin && <th className="table-th w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, idx) => {
                    const badge     = difBadge(r.diferencia);
                    const isSelected = r.id === selectedCubRow?.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedCubId(r.id)}
                        className={`cursor-pointer transition-colors hover:bg-green-50/40 ${
                          isSelected
                            ? "ring-1 ring-inset ring-green-300"
                            : idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"
                        }`}
                        style={isSelected ? { backgroundColor: C_SELECTED } : {}}
                      >
                        <td className="table-td-left font-medium text-gray-700">
                          {r.fecha_hora ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm", { locale: es }) : r.fecha}
                          {isSelected && <span className="ml-2 text-[10px] font-bold text-green-600 uppercase">● selec.</span>}
                        </td>
                        <td className={`table-td font-semibold ${prodColor(r.productividad_drone)}`}>
                          {fmt(r.productividad_drone)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className={`table-td font-semibold ${prodColor(r.productividad_drone)}`}>{fmt(r.produccion_drone)}</td>
                        <td className="table-td text-gray-600">{fmt(r.diferencia_horometro, 1)}</td>
                        <td className={`table-td ${(r.detencion ?? 0) > 0 ? "text-red-400" : "text-gray-400"}`}>{fmt(r.detencion, 1)}</td>
                        <td className="table-td text-gray-600">
                          {fmt(r.productividad_pesometro)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className="table-td text-gray-600">{fmt(r.produccion_pesometro)}</td>
                        <td className="table-td text-gray-600">{r.cantidad_despachos ?? "–"}</td>
                        <td className="table-td text-gray-600">{fmt(r.despachos_ton)}</td>
                        <td className="table-td text-gray-500">
                          {fmt(r.productividad_hrs_reales)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className={`table-td font-semibold ${invColor(r.inventario_ton)}`}>{fmt(r.inventario_ton)}</td>
                        <td className="table-td">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span>
                        </td>
                        {isAdmin && (
                          <td className="table-td">
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditRow(r); }}
                              className="text-gray-300 hover:text-migrin transition-colors text-base leading-none"
                              title="Editar"
                            >✏️</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/60">
                <span className="text-xs text-gray-400">Mostrando {visible.length} de {reversed.length} registros</span>
                <div className="flex gap-2">
                  {hayMenos && (
                    <button className="btn-secondary text-xs py-1 px-3" onClick={() => setCubLimit(l => Math.max(CUB_INIT, l - CUB_STEP))}>
                      Ver 10 menos
                    </button>
                  )}
                  {hayMas && (
                    <button className="btn-secondary text-xs py-1 px-3" onClick={() => setCubLimit(l => l + CUB_STEP)}>
                      Ver 10 más
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECCIÓN 2 — SEMANAL
      ══════════════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader
          title="Por Semana"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                {(["todo", "S1", "S2"] as const).map((op) => (
                  <button
                    key={op}
                    onClick={() => setSemSemestre(op)}
                    className="px-3 py-1 transition-colors"
                    style={semSemestre === op
                      ? { backgroundColor: C_DRONE, color: "#fff" }
                      : { backgroundColor: "#fff", color: "#374151" }}
                  >
                    {op === "todo" ? "Año completo" : op}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {aniosDisponibles.map((anio) => {
                  const activo = semAnios.includes(anio);
                  return (
                    <button
                      key={anio}
                      onClick={() => setSemAnios(prev => activo ? prev.filter(a => a !== anio) : [...prev, anio])}
                      className="px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors"
                      style={activo
                        ? { backgroundColor: C_DRONE + "22", borderColor: C_DRONE + "88", color: C_DRONE }
                        : { backgroundColor: "#fff", borderColor: "#e5e7eb", color: "#9ca3af" }}
                    >
                      {anio}
                    </button>
                  );
                })}
              </div>
            </div>
          }
        />

        {/* Panel semana seleccionada */}
        {selectedSem && (
          <InfoPanel hint="Pincha una barra del gráfico o una fila de la tabla para ver esa semana">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Semana</p>
              <p className="text-sm font-semibold text-gray-900">{selectedSem.semana}</p>
            </div>
            <StatMini label="Hrs Productivas"      value={`${fmt(selectedSem.hrsProd, 1)} hrs`} />
            <StatMini label="Detención"            value={`${fmt(selectedSem.detencion, 1)} hrs · ${selectedSemDetPct.toFixed(1)}%`} color="text-red-400" />
            <StatMini label="Despachos"            value={`${fmt(selectedSem.despachos)} ton · ${selectedSem.viajes} vj`} />
            <StatMini label="Producción Drone"     value={`${fmt(selectedSem.prodDrone)} ton`} />
            <StatMini label="Productividad Drone"  value={`${fmt(selectedSemKpiD)} t/h`}  color={prodColor(selectedSemKpiD)} />
            <StatMini label="Producción Pesóm."    value={`${fmt(selectedSem.prodPeso)} ton`} />
            <StatMini label="Productividad Pesóm." value={`${fmt(selectedSemKpiP)} t/h`} />
          </InfoPanel>
        )}

        {/* Gráfico semanal */}
        {chartSemanal.length > 0 && (
          <div className="card mb-4 cursor-pointer">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={chartSemanal}
                margin={{ top: 5, right: 20, left: 10, bottom: 45 }}
                onClick={(data) => {
                  if (!data?.activePayload?.[0]) return;
                  const key = (data.activePayload[0].payload as { _key: string })._key;
                  setSelectedSemKey(key);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 9 }} interval={0} angle={-45} textAnchor="end" height={55} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  label={{ value: "t/h", angle: -90, position: "insideLeft", offset: -2, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <Tooltip
                  formatter={(value, name) => [`${fmt(value as number)} t/h`, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Legend />
                <Bar dataKey="kpiDrone" name="Productividad Drone" radius={[3, 3, 0, 0]}>
                  {chartSemanal.map((entry) => (
                    <Cell
                      key={entry._key}
                      fill={entry._key === selectedSem?.semana ? C_DRONE : C_DRONE + "99"}
                    />
                  ))}
                </Bar>
                <Bar dataKey="kpiPeso" name="Productividad Pesóm." radius={[3, 3, 0, 0]}>
                  {chartSemanal.map((entry) => (
                    <Cell
                      key={entry._key}
                      fill={entry._key === selectedSem?.semana ? C_PESO : C_PESO + "88"}
                    />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {semanalFiltradas.length === 0 && (
          <div className="card text-center py-10 text-sm text-gray-400">Sin datos para la selección actual</div>
        )}

        {/* Tabla semanal */}
        {semanalFiltradas.length > 0 && (
          <div className="card overflow-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="table-th text-left">Semana</th>
                  <th className="table-th">Hrs Prod.</th>
                  <th className="table-th">Detención (hrs)</th>
                  <th className="table-th">Det. Planta %</th>
                  <th className="table-th">Despachos (ton)</th>
                  <th className="table-th">Despachos (vj)</th>
                  <th className="table-th">Prod. Pesóm.</th>
                  <th className="table-th">Productividad Pesóm.</th>
                  <th className="table-th">Prod. Drone</th>
                  <th className="table-th">Productividad Drone</th>
                  <th className="table-th">Prod / día</th>
                </tr>
              </thead>
              <tbody>
                {[...semanalFiltradas].reverse().map((s, idx) => {
                  const kpiD   = s.hrsProd > 0 ? s.prodDrone / s.hrsProd : 0;
                  const kpiP   = s.hrsProd > 0 ? s.prodPeso  / s.hrsProd : 0;
                  const detPct = (s.hrsProd + s.detencion) > 0 ? s.detencion / (s.hrsProd + s.detencion) * 100 : 0;
                  const isSel  = s.semana === selectedSem?.semana;
                  return (
                    <tr
                      key={s.semana}
                      onClick={() => setSelectedSemKey(s.semana)}
                      className="cursor-pointer transition-colors hover:bg-green-50/40"
                      style={isSel
                        ? { backgroundColor: C_SELECTED, boxShadow: `inset 3px 0 0 ${C_DRONE}` }
                        : { backgroundColor: idx % 2 === 0 ? "#fff" : "#f9fafb" }}
                    >
                      <td className="table-td-left font-medium text-gray-700">
                        {s.semana}
                        {isSel && <span className="ml-2 text-[10px] font-bold text-green-600 uppercase">● selec.</span>}
                      </td>
                      <td className="table-td text-gray-600">{fmt(s.hrsProd, 1)}</td>
                      <td className="table-td text-red-400">{fmt(s.detencion, 1)}</td>
                      <td className="table-td text-gray-500">{detPct.toFixed(1)}%</td>
                      <td className="table-td text-gray-600">{fmt(s.despachos)}</td>
                      <td className="table-td text-gray-600">{s.viajes}</td>
                      <td className="table-td text-gray-600">{fmt(s.prodPeso)}</td>
                      <td className="table-td font-semibold" style={{ color: C_PESO }}>
                        {fmt(kpiP)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                      </td>
                      <td className="table-td text-gray-600">{fmt(s.prodDrone)}</td>
                      <td className={`table-td font-semibold ${prodColor(kpiD)}`}>
                        {fmt(kpiD)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                      </td>
                      <td className="table-td text-gray-500">{fmt(s.prodDrone / Math.max(s.dias, 1))}</td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 border-t border-gray-100 font-semibold text-gray-700">
                  <td className="table-td-left">Total</td>
                  <td className="table-td">{fmt(semanalFiltradas.reduce((a, s) => a + s.hrsProd,   0), 1)}</td>
                  <td className="table-td text-red-400">{fmt(semanalFiltradas.reduce((a, s) => a + s.detencion, 0), 1)}</td>
                  <td className="table-td text-gray-400">–</td>
                  <td className="table-td">{fmt(semanalFiltradas.reduce((a, s) => a + s.despachos, 0))}</td>
                  <td className="table-td">{semanalFiltradas.reduce((a, s) => a + s.viajes, 0)}</td>
                  <td className="table-td">{fmt(semanalFiltradas.reduce((a, s) => a + s.prodPeso,  0))}</td>
                  <td className="table-td text-gray-400">–</td>
                  <td className="table-td">{fmt(semanalFiltradas.reduce((a, s) => a + s.prodDrone, 0))}</td>
                  <td className="table-td text-gray-400">–</td>
                  <td className="table-td text-gray-400">–</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECCIÓN 3 — HISTORIAL (solo admin)
      ══════════════════════════════════════════════════════════════════ */}
      {isAdmin && (
        <section>
          <SectionHeader
            title="Historial de cambios"
            action={
              <button className="btn-secondary text-xs" onClick={() => { if (!showHistorial) loadHistorial(); setShowHistorial(h => !h); }}>
                {showHistorial ? "Ocultar" : "Ver historial"}
              </button>
            }
          />
          {showHistorial && (
            <div className="card overflow-auto p-0">
              {historial.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Sin cambios registrados</p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="table-th text-left">Fecha cambio</th>
                      <th className="table-th text-left">Campo</th>
                      <th className="table-th text-left">Valor anterior</th>
                      <th className="table-th text-left">Valor nuevo</th>
                      <th className="table-th text-left">Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((h, idx) => (
                      <tr key={h.id} className={`hover:bg-gray-50 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}>
                        <td className="table-td-left text-gray-500">{format(new Date(h.created_at), "dd/MM/yyyy HH:mm")}</td>
                        <td className="table-td-left font-medium text-gray-700">{h.campo}</td>
                        <td className="table-td-left text-red-500">{h.valor_anterior || "–"}</td>
                        <td className="table-td-left text-green-600 font-semibold">{h.valor_nuevo || "–"}</td>
                        <td className="table-td-left text-gray-400 text-xs">{h.usuario_email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      )}

    </div>

    {editRow && (
      <EditArenaModal
        registro={editRow}
        userEmail={session?.user?.email ?? ""}
        onClose={() => setEditRow(null)}
        onSaved={() => { setEditRow(null); loadData(); }}
      />
    )}
    </>
  );
}
