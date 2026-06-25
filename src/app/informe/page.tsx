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

interface HistorialCambio {
  id: string;
  campo: string;
  valor_anterior: string;
  valor_nuevo: string;
  usuario_email: string;
  created_at: string;
  registro_id: string;
}

interface SemanaStat {
  semana:   string;
  prodDrone: number;
  prodPeso:  number;
  despachos: number;
  dias:      number;
  hrsProd:   number;
}

// ─── helpers de color ────────────────────────────────────────────────────────
const PROD_TARGET = 32;
const INV_TARGET  = 7500;
const INV_WARN    = 6500;

function prodColor(v?: number | null) {
  if (!v) return "text-gray-700";
  if (v >= PROD_TARGET) return "text-green-600";
  if (v >= PROD_TARGET * 0.9) return "text-yellow-500";
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

// ─── componente cabecera de sección ──────────────────────────────────────────
function SectionHeader({
  title, sub, action,
}: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="w-1 h-5 bg-green-500 rounded-full" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-600">{title}</h2>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
      {action}
    </div>
  );
}

export default function InformePage() {
  const { data: session }     = useSession();
  const isAdmin               = session?.user?.rol === "admin";

  const [rows, setRows]       = useState<RegistroArena[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState<RegistroArena | null>(null);
  const [historial, setHistorial] = useState<HistorialCambio[]>([]);
  const [showHistorial, setShowHistorial] = useState(false);

  // Cubicación: paginación
  const [cubLimit, setCubLimit] = useState(20);

  // Semanal: filtros
  const [semAnios,    setSemAnios]    = useState<number[]>([]);   // se inicializa tras cargar datos
  const [semSemestre, setSemSemestre] = useState<"todo" | "S1" | "S2">("todo");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: true });
    setRows(data ?? []);
    setLoading(false);
    // inicializar filtro semanal con el año actual
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

  // ── Datos gráfico cubicación: últimos 30 droneos ──────────────────────────
  const last30 = rows.slice(-30);
  const chartCubicacion = last30.map((r) => ({
    fecha:        format(parseISO(r.fecha), "dd/MM"),
    prodDrone:    r.produccion_drone,
    prodPeso:     r.produccion_pesometro,
    inventario:   r.inventario_ton,
  }));
  const avgProdDrone = last30.reduce((s, r) => s + (r.produccion_drone ?? 0), 0) / (last30.length || 1);

  // ── Datos resumen semanal ─────────────────────────────────────────────────
  const semanas: Record<string, SemanaStat> = {};
  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = rows[i - 1];
    const anio = parseISO(r.fecha).getFullYear();
    const sem  = `${anio}-S${String(getISOWeek(parseISO(r.fecha))).padStart(2, "0")}`;
    const diasPeriodo = Math.max(1,
      Math.round((new Date(r.fecha).getTime() - new Date(prev.fecha).getTime()) / 86400000)
    );
    if (!semanas[sem]) semanas[sem] = { semana: sem, prodDrone: 0, prodPeso: 0, despachos: 0, dias: 0, hrsProd: 0 };
    semanas[sem].prodDrone += r.produccion_drone ?? 0;
    semanas[sem].prodPeso  += r.produccion_pesometro ?? 0;
    semanas[sem].despachos += r.despachos_ton ?? 0;
    semanas[sem].dias      += diasPeriodo;
    semanas[sem].hrsProd   += r.diferencia_horometro ?? 0;
  }
  const semanalRows = Object.values(semanas).sort((a, b) => a.semana.localeCompare(b.semana));

  const anioActual  = new Date().getFullYear();

  // Años disponibles en los datos
  const aniosDisponibles = [...new Set(semanalRows.map((s) => parseInt(s.semana.split("-")[0])))].sort();

  // Filtros semanal: semestre
  const S1_WEEKS = Array.from({ length: 26 }, (_, i) => String(i + 1).padStart(2, "0")); // S01–S26
  const S2_WEEKS = Array.from({ length: 26 }, (_, i) => String(i + 27).padStart(2, "0")); // S27–S52/53

  const semanalFiltradas = semanalRows.filter((s) => {
    const [anioStr, semStr] = s.semana.split("-S");
    const anio = parseInt(anioStr);
    const sem  = semStr;
    if (!semAnios.includes(anio)) return false;
    if (semSemestre === "S1" && !S1_WEEKS.includes(sem)) return false;
    if (semSemestre === "S2" && !S2_WEEKS.includes(sem)) return false;
    return true;
  });

  // Chart semanal: usa las filas filtradas, etiqueta = "YYYY-Sxx" o solo "Sxx" si un solo año
  const soloUnAnio = semAnios.length === 1;
  const chartSemanal = semanalFiltradas.map((s) => ({
    semana:       soloUnAnio ? s.semana.replace(`${semAnios[0]}-`, "") : s.semana,
    prodDrone:    +s.prodDrone.toFixed(1),
    prodPeso:     +s.prodPeso.toFixed(1),
    prodDroneKpi: s.hrsProd > 0 ? +(s.prodDrone / s.hrsProd).toFixed(2) : null,
    prodPesoKpi:  s.hrsProd > 0 ? +(s.prodPeso  / s.hrsProd).toFixed(2) : null,
  }));

  // ── Totales globales ──────────────────────────────────────────────────────
  const totalProdDrone  = rows.reduce((s, r) => s + (r.produccion_drone ?? 0), 0);
  const totalProdPeso   = rows.reduce((s, r) => s + (r.produccion_pesometro ?? 0), 0);
  const totalDespachos  = rows.reduce((s, r) => s + (r.despachos_ton ?? 0), 0);
  const avgProductividad = rows.reduce((s, r) => s + (r.productividad_drone ?? 0), 0) / (rows.length || 1);

  // ── Último droneo ─────────────────────────────────────────────────────────
  const ultimoRow = rows.length > 0 ? rows[rows.length - 1] : null;

  // ── Exportar Excel ────────────────────────────────────────────────────────
  function exportExcel() {
    const dataCub = rows.map((r) => ({
      "Fecha y hora":             r.fecha_hora ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm") : "",
      "Horas Productivas":        r.diferencia_horometro ?? "",
      "Detención (hrs)":          r.detencion ?? "",
      "Despachos (Viajes)":       r.cantidad_despachos ?? "",
      "Despachos (Ton)":          r.despachos_ton ?? "",
      "Producción (Pesómetro)":   r.produccion_pesometro ?? "",
      "Productividad (Pesómetro)":r.productividad_pesometro ?? "",
      "Producción (Drone)":       r.produccion_drone ?? "",
      "Productividad (Drone)":    r.productividad_drone ?? "",
      "Productividad Hrs Reales": r.productividad_hrs_reales ?? "",
      "Inventario (Ton)":         r.inventario_ton ?? "",
      "Fierrillo (m3)":           r.fierrillo ?? "",
      "Cancha Vieja (Ton)":       r.cancha_vieja_ton ?? "",
      "Cancha Nueva (Ton)":       r.cancha_nueva_ton ?? "",
      "Diferencia":               r.diferencia ? (r.diferencia * 100).toFixed(1) + "%" : "",
      "Notas":                    r.notas ?? "",
    }));

    const dataSem = semanalRows.map((s) => ({
      "Semana":            s.semana,
      "Producción Drone":  s.prodDrone.toFixed(2),
      "Producción Pesóm.": s.prodPeso.toFixed(2),
      "Despachos":         s.despachos.toFixed(2),
      "Días":              s.dias,
      "Prod/día":          (s.prodDrone / Math.max(s.dias, 1)).toFixed(2),
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

      {/* ── KPIs globales ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Productividad prom."
          value={fmt(avgProductividad)}
          unit="ton / hora"
          color={avgProductividad >= PROD_TARGET ? "green" : avgProductividad >= PROD_TARGET * 0.9 ? "yellow" : "red"}
        />
        <KpiCard
          label="Producción Drone total"
          value={fmt(totalProdDrone)}
          unit="toneladas"
          color="green"
        />
        <KpiCard
          label="Despachos total"
          value={fmt(totalDespachos)}
          unit="toneladas"
          color="gray"
        />
        <KpiCard
          label="Producción Pesóm. total"
          value={fmt(totalProdPeso)}
          unit="toneladas"
          color="slate"
        />
      </div>

      {/* ── Panel último droneo ──────────────────────────────────────────── */}
      {ultimoRow && (
        <div className="card border-l-4 border-l-green-400 py-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="label">Último droneo</p>
              <p className="text-sm font-semibold text-gray-900">
                {format(parseISO(ultimoRow.fecha), "dd 'de' MMMM yyyy", { locale: es })}
                {ultimoRow.hora && (
                  <span className="text-gray-400 font-normal ml-1">· {ultimoRow.hora.slice(0, 5)}</span>
                )}
              </p>
            </div>
            <div>
              <p className="label">Producción Drone</p>
              <p className={`text-sm font-bold ${prodColor(ultimoRow.produccion_drone)}`}>
                {fmt(ultimoRow.produccion_drone)} ton
              </p>
            </div>
            <div>
              <p className="label">Productividad</p>
              <p className={`text-sm font-bold ${prodColor(ultimoRow.productividad_drone)}`}>
                {fmt(ultimoRow.productividad_drone)} t/h
              </p>
            </div>
            <div>
              <p className="label">Inventario</p>
              <p className={`text-sm font-bold ${invColor(ultimoRow.inventario_ton)}`}>
                {fmt(ultimoRow.inventario_ton)} ton
              </p>
            </div>
            <div>
              <p className="label">Despachos</p>
              <p className="text-sm font-semibold text-gray-700">
                {fmt(ultimoRow.despachos_ton)} ton
                {ultimoRow.cantidad_despachos != null && (
                  <span className="text-gray-400 font-normal ml-1">· {ultimoRow.cantidad_despachos} viajes</span>
                )}
              </p>
            </div>
            <div>
              <p className="label">Diferencia</p>
              {(() => {
                const b = difBadge(ultimoRow.diferencia);
                return (
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${b.bg} ${b.text}`}>
                    {b.label}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECCIÓN 1 — POR CUBICACIÓN
      ══════════════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader title="Por Cubicación" sub="últimos 30 droneos" />

        {/* Gráfico cubicación — producción en eje izq., inventario en eje der. */}
        {chartCubicacion.length > 0 && (
          <div className="card mb-4">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartCubicacion} margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="prod"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}`}
                  label={{ value: "ton", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <YAxis
                  yAxisId="inv"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}`}
                  label={{ value: "inv ton", angle: 90, position: "insideRight", offset: 10, style: { fontSize: 9, fill: "#3b82f6" } }}
                />
                <Tooltip
                  formatter={(v, name) => [fmt(v as number) + " ton", name]}
                />
                <Legend />
                <ReferenceLine yAxisId="prod" y={avgProdDrone} stroke="#22c55e" strokeDasharray="5 5"
                  label={{ value: "Prom.", fill: "#22c55e", fontSize: 9 }} />
                <Line yAxisId="prod" type="monotone" dataKey="prodDrone"  name="Prod. Drone"     stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="prod" type="monotone" dataKey="prodPeso"   name="Prod. Pesómetro" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="inv"  type="monotone" dataKey="inventario" name="Inventario"      stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabla */}
        {(() => {
          const reversed = [...rows].reverse();
          const visible  = reversed.slice(0, cubLimit);
          const hayMas   = cubLimit < reversed.length;
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
                        <td className={`table-td font-semibold ${prodColor(r.produccion_drone)}`}>
                          {fmt(r.produccion_drone)}
                        </td>
                        <td className="table-td text-gray-600">{fmt(r.diferencia_horometro, 1)}</td>
                        <td className={`table-td ${(r.detencion ?? 0) > 0 ? "text-red-400" : "text-gray-400"}`}>
                          {fmt(r.detencion, 1)}
                        </td>
                        <td className="table-td text-slate-500">
                          {fmt(r.productividad_pesometro)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className="table-td text-slate-500">{fmt(r.produccion_pesometro)}</td>
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

              {/* Pie de tabla: contador + botón cargar más */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/60">
                <span className="text-xs text-gray-400">
                  Mostrando {visible.length} de {reversed.length} registros
                </span>
                {hayMas && (
                  <button
                    className="btn-secondary text-xs py-1 px-3"
                    onClick={() => setCubLimit(l => l + 10)}
                  >
                    Ver 10 más
                  </button>
                )}
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
              {/* Filtro semestre */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                {(["todo", "S1", "S2"] as const).map((op) => (
                  <button
                    key={op}
                    onClick={() => setSemSemestre(op)}
                    className={`px-3 py-1 transition-colors ${
                      semSemestre === op
                        ? "bg-green-500 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {op === "todo" ? "Año completo" : op}
                  </button>
                ))}
              </div>

              {/* Filtro años */}
              <div className="flex flex-wrap gap-1">
                {aniosDisponibles.map((anio) => {
                  const activo = semAnios.includes(anio);
                  return (
                    <button
                      key={anio}
                      onClick={() =>
                        setSemAnios((prev) =>
                          activo
                            ? prev.filter((a) => a !== anio)
                            : [...prev, anio]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        activo
                          ? "bg-green-50 border-green-300 text-green-700"
                          : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                      }`}
                    >
                      {anio}
                    </button>
                  );
                })}
              </div>
            </div>
          }
        />

        {/* Gráfico semanal — producción como barras, productividad como líneas en eje der. */}
        {chartSemanal.length > 0 && (
          <div className="card mb-4">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartSemanal} margin={{ top: 5, right: 50, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 9 }} interval={0} angle={-45} textAnchor="end" height={50} />
                <YAxis
                  yAxisId="ton"
                  tick={{ fontSize: 10 }}
                  label={{ value: "ton", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <YAxis
                  yAxisId="kpi"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  domain={[0, "auto"]}
                  label={{ value: "t/h", angle: 90, position: "insideRight", offset: 10, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <Tooltip
                  formatter={(v, name) => {
                    const isKpi = String(name).includes("Productividad");
                    return [fmt(v as number) + (isKpi ? " t/h" : " ton"), name];
                  }}
                />
                <Legend />
                <Bar yAxisId="ton" dataKey="prodDrone" name="Prod. Drone"     fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="ton" dataKey="prodPeso"  name="Prod. Pesómetro" fill="#f97316" radius={[3, 3, 0, 0]} />
                <Line yAxisId="kpi" type="monotone" dataKey="prodDroneKpi" name="Productividad Drone"     stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="kpi" type="monotone" dataKey="prodPesoKpi"  name="Productividad Pesómetro" stroke="#ea580c" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {semanalFiltradas.length === 0 && (
          <div className="card text-center py-10 text-sm text-gray-400">
            Sin datos para la selección actual
          </div>
        )}

        {/* Tabla */}
        {semanalFiltradas.length > 0 && (
          <div className="card overflow-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="table-th text-left">Semana</th>
                  <th className="table-th">Producción Drone</th>
                  <th className="table-th">Producción Pesóm.</th>
                  <th className="table-th">Despachos</th>
                  <th className="table-th">Días</th>
                  <th className="table-th">Prod / día</th>
                </tr>
              </thead>
              <tbody>
                {[...semanalFiltradas].reverse().map((s, idx) => (
                  <tr
                    key={s.semana}
                    className={`transition-colors hover:bg-green-50/30 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                  >
                    <td className="table-td-left font-medium text-gray-700">{s.semana}</td>
                    <td className="table-td font-semibold text-green-700">{fmt(s.prodDrone)}</td>
                    <td className="table-td text-slate-500">{fmt(s.prodPeso)}</td>
                    <td className="table-td text-gray-600">{fmt(s.despachos)}</td>
                    <td className="table-td text-gray-500">{s.dias}</td>
                    <td className="table-td text-gray-600">{fmt(s.prodDrone / Math.max(s.dias, 1))}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t border-gray-100 font-semibold">
                  <td className="table-td-left text-gray-700">Total</td>
                  <td className="table-td text-green-700">{fmt(semanalFiltradas.reduce((s, r) => s + r.prodDrone, 0))}</td>
                  <td className="table-td text-slate-500">{fmt(semanalFiltradas.reduce((s, r) => s + r.prodPeso, 0))}</td>
                  <td className="table-td text-gray-600">{fmt(semanalFiltradas.reduce((s, r) => s + r.despachos, 0))}</td>
                  <td className="table-td text-gray-500">{semanalFiltradas.reduce((s, r) => s + r.dias, 0)}</td>
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
                onClick={() => {
                  if (!showHistorial) loadHistorial();
                  setShowHistorial(h => !h);
                }}
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
                      <tr
                        key={h.id}
                        className={`transition-colors hover:bg-gray-50 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                      >
                        <td className="table-td-left text-gray-500">
                          {format(new Date(h.created_at), "dd/MM/yyyy HH:mm")}
                        </td>
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

    {/* Modal de edición */}
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

function KpiCard({ label, value, unit, color }: {
  label: string; value: string; unit: string;
  color: "green" | "yellow" | "red" | "blue" | "gray" | "slate";
}) {
  const valueColors: Record<string, string> = {
    green:  "text-green-600",
    yellow: "text-yellow-500",
    red:    "text-red-500",
    blue:   "text-blue-600",
    gray:   "text-gray-700",
    slate:  "text-slate-600",
  };
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${valueColors[color] ?? "text-gray-900"}`}>{value}</span>
      <span className="text-xs text-gray-400">{unit}</span>
    </div>
  );
}
