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
} from "recharts";
import { EditArenaModal } from "@/components/EditArenaModal";

// ─── Paleta corporativa ───────────────────────────────────────────────────────
const C_DRONE = "#6BCF7F";   // migrin verde
const C_PESO  = "#374151";   // antracita
const C_INV   = "#94a3b8";   // slate claro (inventario, eje secundario)

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
  semana:    string;
  prodDrone: number;
  prodPeso:  number;
  despachos: number;
  viajes:    number;
  dias:      number;
  hrsProd:   number;
  detencion: number;
}

// ─── Helpers de color ─────────────────────────────────────────────────────────
function prodColor(v?: number | null) {
  if (!v) return "text-gray-700";
  if (v >= PROD_TARGET)        return "text-green-600";
  if (v >= PROD_TARGET * 0.9)  return "text-yellow-500";
  return "text-red-500";
}
function invColor(v?: number | null) {
  if (!v) return "text-gray-700";
  if (v >= INV_TARGET) return "text-green-600";
  if (v >= INV_WARN)   return "text-yellow-500";
  return "text-red-500";
}
function difBadge(dif?: number | null) {
  if (dif == null) return { bg: "bg-gray-100", text: "text-gray-500", label: "–" };
  const pct = (dif * 100).toFixed(1) + "%";
  if (dif > 0.1)  return { bg: "bg-red-100",   text: "text-red-700",   label: pct };
  if (dif < -0.1) return { bg: "bg-green-100", text: "text-green-700", label: pct };
  return { bg: "bg-gray-100", text: "text-gray-600", label: pct };
}

// ─── Cabecera de sección ──────────────────────────────────────────────────────
function SectionHeader({
  title, sub, action,
}: { title: string; sub?: string; action?: React.ReactNode }) {
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

// ─── Tooltip personalizado para gráficos ──────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{fmt(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function InformePage() {
  const { data: session } = useSession();
  const isAdmin           = session?.user?.rol === "admin";

  const [rows, setRows]         = useState<RegistroArena[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editRow, setEditRow]   = useState<RegistroArena | null>(null);
  const [historial, setHistorial] = useState<HistorialCambio[]>([]);
  const [showHistorial, setShowHistorial] = useState(false);

  // Cubicación: paginación (empieza en 15, crece de 10 en 10)
  const [cubLimit, setCubLimit] = useState(CUB_INIT);

  // Semanal: filtros
  const [semAnios,    setSemAnios]    = useState<number[]>([]);
  const [semSemestre, setSemSemestre] = useState<"todo" | "S1" | "S2">("todo");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: true });
    setRows(data ?? []);
    setLoading(false);
    if (semAnios.length === 0) setSemAnios([new Date().getFullYear()]);
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

  // ── Gráfico + tabla cubicación: últimos cubLimit registros ────────────────
  const cubRows     = rows.slice(-cubLimit);
  const avgProdKpi  = cubRows.reduce((s, r) => s + (r.productividad_drone ?? 0), 0) / (cubRows.length || 1);

  const chartCubicacion = cubRows.map((r) => ({
    fecha:      format(parseISO(r.fecha), "dd/MM"),
    kpiDrone:   r.productividad_drone,
    kpiPeso:    r.productividad_pesometro,
    inventario: r.inventario_ton,
  }));

  // ── Resumen semanal ───────────────────────────────────────────────────────
  const semanas: Record<string, SemanaStat> = {};
  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = rows[i - 1];
    const anio = parseISO(r.fecha).getFullYear();
    const sem  = `${anio}-S${String(getISOWeek(parseISO(r.fecha))).padStart(2, "0")}`;
    const diasPeriodo = Math.max(1,
      Math.round((new Date(r.fecha).getTime() - new Date(prev.fecha).getTime()) / 86400000)
    );
    if (!semanas[sem]) semanas[sem] = {
      semana: sem, prodDrone: 0, prodPeso: 0, despachos: 0,
      viajes: 0, dias: 0, hrsProd: 0, detencion: 0,
    };
    semanas[sem].prodDrone += r.produccion_drone    ?? 0;
    semanas[sem].prodPeso  += r.produccion_pesometro ?? 0;
    semanas[sem].despachos += r.despachos_ton        ?? 0;
    semanas[sem].viajes    += r.cantidad_despachos   ?? 0;
    semanas[sem].dias      += diasPeriodo;
    semanas[sem].hrsProd   += r.diferencia_horometro ?? 0;
    semanas[sem].detencion += r.detencion            ?? 0;
  }
  const semanalRows = Object.values(semanas).sort((a, b) => a.semana.localeCompare(b.semana));
  const anioActual  = new Date().getFullYear();
  const aniosDisponibles = [...new Set(semanalRows.map((s) => parseInt(s.semana.split("-")[0])))].sort();

  const S1_WEEKS = Array.from({ length: 26 }, (_, i) => String(i +  1).padStart(2, "0"));
  const S2_WEEKS = Array.from({ length: 26 }, (_, i) => String(i + 27).padStart(2, "0"));

  const semanalFiltradas = semanalRows.filter((s) => {
    const [anioStr, semStr] = s.semana.split("-S");
    if (!semAnios.includes(parseInt(anioStr))) return false;
    if (semSemestre === "S1" && !S1_WEEKS.includes(semStr)) return false;
    if (semSemestre === "S2" && !S2_WEEKS.includes(semStr)) return false;
    return true;
  });

  const soloUnAnio   = semAnios.length === 1;
  const chartSemanal = semanalFiltradas.map((s) => ({
    semana:       soloUnAnio ? s.semana.replace(`${semAnios[0]}-`, "") : s.semana,
    kpiDrone:     s.hrsProd > 0 ? +(s.prodDrone / s.hrsProd).toFixed(2) : null,
    kpiPeso:      s.hrsProd > 0 ? +(s.prodPeso  / s.hrsProd).toFixed(2) : null,
  }));

  // ── Exportar Excel ────────────────────────────────────────────────────────
  function exportExcel() {
    const dataCub = rows.map((r) => ({
      "Fecha y hora":              r.fecha_hora ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm") : "",
      "Horas Productivas":         r.diferencia_horometro ?? "",
      "Detención (hrs)":           r.detencion ?? "",
      "Despachos (Viajes)":        r.cantidad_despachos ?? "",
      "Despachos (Ton)":           r.despachos_ton ?? "",
      "Producción (Pesómetro)":    r.produccion_pesometro ?? "",
      "Productividad (Pesómetro)": r.productividad_pesometro ?? "",
      "Producción (Drone)":        r.produccion_drone ?? "",
      "Productividad (Drone)":     r.productividad_drone ?? "",
      "Productividad Hrs Reales":  r.productividad_hrs_reales ?? "",
      "Inventario (Ton)":          r.inventario_ton ?? "",
      "Diferencia":                r.diferencia ? (r.diferencia * 100).toFixed(1) + "%" : "",
      "Notas":                     r.notas ?? "",
    }));
    const dataSem = semanalRows.map((s) => ({
      "Semana":                s.semana,
      "Horas Productivas":     s.hrsProd.toFixed(1),
      "Detención (hrs)":       s.detencion.toFixed(1),
      "Despachos (Ton)":       s.despachos.toFixed(2),
      "Despachos (Viajes)":    s.viajes,
      "Producción (Pesóm.)":   s.prodPeso.toFixed(2),
      "Productividad (Pesóm.)":s.hrsProd > 0 ? (s.prodPeso / s.hrsProd).toFixed(2) : "",
      "Producción (Drone)":    s.prodDrone.toFixed(2),
      "Productividad (Drone)": s.hrsProd > 0 ? (s.prodDrone / s.hrsProd).toFixed(2) : "",
      "Días":                  s.dias,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataCub), "Por Cubicación");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataSem), "Por Semana");
    XLSX.writeFile(wb, `Informe_Arena_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Cargando...</div>
  );

  return (
    <>
    <div className="space-y-8">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informe Producción Arena</h1>
          <p className="text-sm text-gray-500">
            {rows.length > 0
              ? <>Del {format(parseISO(rows[0].fecha), "dd/MM/yyyy")} al {format(parseISO(rows[rows.length - 1].fecha), "dd/MM/yyyy")}
                {" · "}{rows.length} cubicaciones</>
              : "Sin datos"}
          </p>
        </div>
        <button className="btn-secondary" onClick={exportExcel}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exportar Excel
        </button>
      </div>

      {/* ── Panel último droneo ──────────────────────────────────────────── */}
      {ultimoRow && (
        <div className="card py-3" style={{ borderLeft: `4px solid ${C_DRONE}` }}>
          <p className="label mb-2">Último droneo</p>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-gray-400">Fecha</p>
              <p className="text-sm font-semibold text-gray-900">
                {format(parseISO(ultimoRow.fecha), "dd 'de' MMMM yyyy", { locale: es })}
                {ultimoRow.hora && <span className="text-gray-400 font-normal ml-1">· {ultimoRow.hora.slice(0, 5)}</span>}
              </p>
            </div>
            <StatMini label="Producción Drone"   value={`${fmt(ultimoRow.produccion_drone)} ton`}   color={prodColor(ultimoRow.productividad_drone)} />
            <StatMini label="Productividad Drone" value={`${fmt(ultimoRow.productividad_drone)} t/h`} color={prodColor(ultimoRow.productividad_drone)} />
            <StatMini label="Producción Pesóm."  value={`${fmt(ultimoRow.produccion_pesometro)} ton`} />
            <StatMini label="Productividad Pesóm." value={`${fmt(ultimoRow.productividad_pesometro)} t/h`} />
            <StatMini label="Despachos"          value={`${fmt(ultimoRow.despachos_ton)} ton · ${ultimoRow.cantidad_despachos ?? 0} vj`} />
            <StatMini label="Inventario"         value={`${fmt(ultimoRow.inventario_ton)} ton`} color={invColor(ultimoRow.inventario_ton)} />
            <div>
              <p className="text-xs text-gray-400">Diferencia</p>
              {(() => { const b = difBadge(ultimoRow.diferencia); return (
                <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-bold ${b.bg} ${b.text}`}>{b.label}</span>
              ); })()}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECCIÓN 1 — POR CUBICACIÓN
      ══════════════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader
          title="Por Cubicación"
          sub={`últimos ${cubRows.length} registros`}
        />

        {/* Gráfico — productividad Drone + Pesóm. (izq.), inventario (der.) */}
        {chartCubicacion.length > 0 && (
          <div className="card mb-4">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartCubicacion} margin={{ top: 5, right: 50, left: 10, bottom: 5 }}>
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
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <ReferenceLine
                  yAxisId="kpi" y={avgProdKpi} stroke={C_DRONE} strokeDasharray="5 5"
                  label={{ value: `Prom. ${fmt(avgProdKpi)}`, fill: C_DRONE, fontSize: 9 }}
                />
                <Line yAxisId="kpi" type="monotone" dataKey="kpiDrone"   name="Productividad Drone"    stroke={C_DRONE} strokeWidth={2.5} dot={{ r: 3, fill: C_DRONE }} connectNulls />
                <Line yAxisId="kpi" type="monotone" dataKey="kpiPeso"    name="Productividad Pesóm."   stroke={C_PESO}  strokeWidth={2.5} dot={{ r: 3, fill: C_PESO  }} connectNulls />
                <Line yAxisId="inv" type="monotone" dataKey="inventario" name="Inventario"             stroke={C_INV}   strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
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
                    const badge = difBadge(r.diferencia);
                    return (
                      <tr
                        key={r.id}
                        className={`transition-colors hover:bg-green-50/30 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                      >
                        <td className="table-td-left font-medium text-gray-700">
                          {r.fecha_hora
                            ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm", { locale: es })
                            : r.fecha}
                        </td>
                        <td className={`table-td font-semibold ${prodColor(r.productividad_drone)}`}>
                          {fmt(r.productividad_drone)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className={`table-td font-semibold ${prodColor(r.productividad_drone)}`}>
                          {fmt(r.produccion_drone)}
                        </td>
                        <td className="table-td text-gray-600">{fmt(r.diferencia_horometro, 1)}</td>
                        <td className={`table-td ${(r.detencion ?? 0) > 0 ? "text-red-400" : "text-gray-400"}`}>
                          {fmt(r.detencion, 1)}
                        </td>
                        <td className="table-td text-gray-600">
                          {fmt(r.productividad_pesometro)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className="table-td text-gray-600">{fmt(r.produccion_pesometro)}</td>
                        <td className="table-td text-gray-600">{r.cantidad_despachos ?? "–"}</td>
                        <td className="table-td text-gray-600">{fmt(r.despachos_ton)}</td>
                        <td className="table-td text-gray-500">
                          {fmt(r.productividad_hrs_reales)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className={`table-td font-semibold ${invColor(r.inventario_ton)}`}>
                          {fmt(r.inventario_ton)}
                        </td>
                        <td className="table-td">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="table-td">
                            <button
                              onClick={() => setEditRow(r)}
                              className="text-gray-300 hover:text-migrin transition-colors text-base leading-none"
                              title="Editar registro"
                            >✏️</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pie: contador + botones expandir/contraer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/60">
                <span className="text-xs text-gray-400">
                  Mostrando {visible.length} de {reversed.length} registros
                </span>
                <div className="flex gap-2">
                  {hayMenos && (
                    <button
                      className="btn-secondary text-xs py-1 px-3"
                      onClick={() => setCubLimit(l => Math.max(CUB_INIT, l - CUB_STEP))}
                    >
                      Ver 10 menos
                    </button>
                  )}
                  {hayMas && (
                    <button
                      className="btn-secondary text-xs py-1 px-3"
                      onClick={() => setCubLimit(l => l + CUB_STEP)}
                    >
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
              {/* Semestre */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                {(["todo", "S1", "S2"] as const).map((op) => (
                  <button
                    key={op}
                    onClick={() => setSemSemestre(op)}
                    className={`px-3 py-1 transition-colors ${
                      semSemestre === op
                        ? "text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                    style={semSemestre === op ? { backgroundColor: C_DRONE, color: "#fff" } : {}}
                  >
                    {op === "todo" ? "Año completo" : op}
                  </button>
                ))}
              </div>
              {/* Años */}
              <div className="flex flex-wrap gap-1">
                {aniosDisponibles.map((anio) => {
                  const activo = semAnios.includes(anio);
                  return (
                    <button
                      key={anio}
                      onClick={() =>
                        setSemAnios((prev) =>
                          activo ? prev.filter((a) => a !== anio) : [...prev, anio]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        activo ? "border-transparent" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                      }`}
                      style={activo ? { backgroundColor: C_DRONE + "22", borderColor: C_DRONE + "66", color: C_DRONE } : {}}
                    >
                      {anio}
                    </button>
                  );
                })}
              </div>
            </div>
          }
        />

        {/* Gráfico semanal — productividad como barras */}
        {chartSemanal.length > 0 && (
          <div className="card mb-4">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartSemanal} margin={{ top: 5, right: 20, left: 10, bottom: 45 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 9 }} interval={0} angle={-45} textAnchor="end" height={55} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  label={{ value: "t/h", angle: -90, position: "insideLeft", offset: -2, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar dataKey="kpiDrone" name="Productividad Drone"    fill={C_DRONE} radius={[3, 3, 0, 0]} />
                <Bar dataKey="kpiPeso"  name="Productividad Pesóm."  fill={C_PESO}  radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {semanalFiltradas.length === 0 && (
          <div className="card text-center py-10 text-sm text-gray-400">
            Sin datos para la selección actual
          </div>
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
                  const kpiDrone = s.hrsProd > 0 ? s.prodDrone / s.hrsProd : 0;
                  const kpiPeso  = s.hrsProd > 0 ? s.prodPeso  / s.hrsProd : 0;
                  const detPct   = (s.hrsProd + s.detencion) > 0
                    ? (s.detencion / (s.hrsProd + s.detencion) * 100) : 0;
                  return (
                    <tr
                      key={s.semana}
                      className={`transition-colors hover:bg-green-50/30 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                    >
                      <td className="table-td-left font-medium text-gray-700">{s.semana}</td>
                      <td className="table-td text-gray-600">{fmt(s.hrsProd, 1)}</td>
                      <td className="table-td text-red-400">{fmt(s.detencion, 1)}</td>
                      <td className="table-td text-gray-500">{detPct.toFixed(1)}%</td>
                      <td className="table-td text-gray-600">{fmt(s.despachos)}</td>
                      <td className="table-td text-gray-600">{s.viajes}</td>
                      <td className="table-td text-gray-600">{fmt(s.prodPeso)}</td>
                      <td className="table-td font-semibold" style={{ color: C_PESO }}>
                        {fmt(kpiPeso)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                      </td>
                      <td className="table-td text-gray-600">{fmt(s.prodDrone)}</td>
                      <td className={`table-td font-semibold ${prodColor(kpiDrone)}`}>
                        {fmt(kpiDrone)} <span className="text-gray-400 font-normal text-xs">t/h</span>
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
          SECCIÓN 3 — HISTORIAL DE CAMBIOS (solo admin)
      ══════════════════════════════════════════════════════════════════ */}
      {isAdmin && (
        <section>
          <SectionHeader
            title="Historial de cambios"
            action={
              <button
                className="btn-secondary text-xs"
                onClick={() => { if (!showHistorial) loadHistorial(); setShowHistorial(h => !h); }}
              >
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

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-semibold ${color ?? "text-gray-800"}`}>{value}</p>
    </div>
  );
}
