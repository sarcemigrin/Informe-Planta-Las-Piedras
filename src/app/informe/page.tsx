"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena } from "@/types/database";
import { format, getISOWeek, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";

interface SemanaStat {
  semana:   string;
  prodDrone: number;
  prodPeso:  number;
  despachos: number;
  dias:      number;
}

export default function InformePage() {
  const [rows, setRows]       = useState<RegistroArena[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: true });
    setRows(data ?? []);
    setLoading(false);
  }

  // ---- Datos gráfico cubicación: últimos 30 droneos ----
  const last30 = rows.slice(-30);
  const chartCubicacion = last30.map((r) => ({
    fecha:        format(parseISO(r.fecha), "dd/MM"),
    prodDrone:    r.produccion_drone,
    prodPeso:     r.produccion_pesometro,
    inventario:   r.inventario_ton,
  }));
  const avgProdDrone = last30.reduce((s, r) => s + (r.produccion_drone ?? 0), 0) / (last30.length || 1);

  // ---- Datos resumen semanal ----
  const semanas: Record<string, SemanaStat> = {};
  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = rows[i - 1];
    const anio = parseISO(r.fecha).getFullYear();
    const sem  = `${anio}-S${String(getISOWeek(parseISO(r.fecha))).padStart(2, "0")}`;
    const diasPeriodo = Math.max(1,
      Math.round((new Date(r.fecha).getTime() - new Date(prev.fecha).getTime()) / 86400000)
    );
    if (!semanas[sem]) semanas[sem] = { semana: sem, prodDrone: 0, prodPeso: 0, despachos: 0, dias: 0 };
    semanas[sem].prodDrone += r.produccion_drone ?? 0;
    semanas[sem].prodPeso  += r.produccion_pesometro ?? 0;
    semanas[sem].despachos += r.despachos_ton ?? 0;
    semanas[sem].dias      += diasPeriodo;
  }
  const semanalRows = Object.values(semanas).sort((a, b) => a.semana.localeCompare(b.semana));

  // Gráfico semanal: solo el año en curso
  const anioActual  = new Date().getFullYear();
  const chartSemanal = semanalRows
    .filter((s) => s.semana.startsWith(String(anioActual)))
    .map((s) => ({
      semana:    s.semana.replace(`${anioActual}-`, ""),
      prodDrone: +s.prodDrone.toFixed(1),
      prodPeso:  +s.prodPeso.toFixed(1),
      despachos: +s.despachos.toFixed(1),
    }));

  // ---- Exportar Excel ----
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">📊 Informe Producción Arena</h1>
          <p className="text-sm text-gray-500">
            {rows.length > 0 && (
              <>Del {format(parseISO(rows[0].fecha), "dd/MM/yyyy")} al {format(parseISO(rows[rows.length - 1].fecha), "dd/MM/yyyy")}
              {" · "}{rows.length} cubicaciones</>
            )}
          </p>
        </div>
        <button className="btn-primary" onClick={exportExcel}>⬇ Descargar Excel</button>
      </div>

      {/* ── KPIs resumen ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Prod. Drone Total"   value={fmt(rows.reduce((s, r) => s + (r.produccion_drone ?? 0), 0))}       unit="ton"   color="green"  />
        <KpiCard label="Prod. Pesóm. Total"  value={fmt(rows.reduce((s, r) => s + (r.produccion_pesometro ?? 0), 0))}    unit="ton"   color="orange" />
        <KpiCard label="Despachos Total"     value={fmt(rows.reduce((s, r) => s + (r.despachos_ton ?? 0), 0))}           unit="ton"   color="blue"   />
        <KpiCard label="Productividad Prom." value={fmt(rows.reduce((s, r) => s + (r.productividad_drone ?? 0), 0) / (rows.length || 1))} unit="ton/h" color="purple" />
      </div>

      {/* ══════════════════════════════════════════
          SECCIÓN 1 — POR CUBICACIÓN
      ══════════════════════════════════════════ */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-gray-800 border-b border-gray-200 pb-2">
          Por Cubicación
          <span className="text-sm font-normal text-gray-400 ml-2">últimos 30 droneos</span>
        </h2>

        {/* Gráfico cubicación */}
        {chartCubicacion.length > 0 && (
          <div className="card">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartCubicacion} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => fmt(v as number) + " ton"} />
                <Legend />
                <ReferenceLine y={avgProdDrone} stroke="#22c55e" strokeDasharray="5 5"
                  label={{ value: "Promedio", fill: "#22c55e", fontSize: 10 }} />
                <Line type="monotone" dataKey="prodDrone"  name="Drone"      stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="prodPeso"   name="Pesómetro"  stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="inventario" name="Inventario" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabla cubicación */}
        <div className="card overflow-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="table-th text-left">Fecha y Hora</th>
                <th className="table-th">Hrs Prod.</th>
                <th className="table-th">Detención</th>
                <th className="table-th">Viajes</th>
                <th className="table-th">Despch. (Ton)</th>
                <th className="table-th">Prod. Pesóm.</th>
                <th className="table-th">Prodvd Pesóm.</th>
                <th className="table-th">Prod. Drone</th>
                <th className="table-th">Prodvd Drone</th>
                <th className="table-th">Prodvd Reales</th>
                <th className="table-th">Inventario</th>
                <th className="table-th">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...rows].reverse().map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="table-td-left font-medium">
                    {r.fecha_hora ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm", { locale: es }) : r.fecha}
                  </td>
                  <td className="table-td">{fmt(r.diferencia_horometro, 1)}</td>
                  <td className="table-td text-red-500">{fmt(r.detencion, 1)}</td>
                  <td className="table-td">{r.cantidad_despachos}</td>
                  <td className="table-td">{fmt(r.despachos_ton)}</td>
                  <td className="table-td text-orange-600">{fmt(r.produccion_pesometro)}</td>
                  <td className="table-td">{fmt(r.productividad_pesometro)} t/h</td>
                  <td className="table-td text-green-700 font-semibold">{fmt(r.produccion_drone)}</td>
                  <td className="table-td font-semibold">{fmt(r.productividad_drone)} t/h</td>
                  <td className="table-td">{fmt(r.productividad_hrs_reales)} t/h</td>
                  <td className="table-td text-blue-700">{fmt(r.inventario_ton)}</td>
                  <td className={`table-td font-semibold ${
                    (r.diferencia ?? 0) > 0.1  ? "text-red-600" :
                    (r.diferencia ?? 0) < -0.1 ? "text-green-600" : "text-gray-600"
                  }`}>
                    {r.diferencia != null ? `${(r.diferencia * 100).toFixed(1)}%` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECCIÓN 2 — SEMANAL
      ══════════════════════════════════════════ */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-gray-800 border-b border-gray-200 pb-2">
          Por Semana
          <span className="text-sm font-normal text-gray-400 ml-2">{anioActual}</span>
        </h2>

        {/* Gráfico semanal */}
        {chartSemanal.length > 0 && (
          <div className="card">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartSemanal} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 9 }} interval={1} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => fmt(v as number) + " ton"} />
                <Legend />
                <Bar dataKey="prodDrone"  name="Drone"      fill="#22c55e" radius={[3,3,0,0]} />
                <Bar dataKey="prodPeso"   name="Pesómetro"  fill="#f97316" radius={[3,3,0,0]} />
                <Bar dataKey="despachos"  name="Despachos"  fill="#3b82f6" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabla semanal */}
        <div className="card overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="table-th text-left">Semana</th>
                <th className="table-th">Prod. Drone</th>
                <th className="table-th">Prod. Pesóm.</th>
                <th className="table-th">Despachos</th>
                <th className="table-th">Días</th>
                <th className="table-th">Prod/día</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...semanalRows].reverse().map((s) => (
                <tr key={s.semana} className="hover:bg-gray-50">
                  <td className="table-td-left font-medium">{s.semana}</td>
                  <td className="table-td text-green-700 font-semibold">{fmt(s.prodDrone)}</td>
                  <td className="table-td text-orange-600">{fmt(s.prodPeso)}</td>
                  <td className="table-td">{fmt(s.despachos)}</td>
                  <td className="table-td">{s.dias}</td>
                  <td className="table-td">{fmt(s.prodDrone / Math.max(s.dias, 1))}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="table-td-left">TOTAL</td>
                <td className="table-td text-green-700">{fmt(semanalRows.reduce((s, r) => s + r.prodDrone, 0))}</td>
                <td className="table-td text-orange-600">{fmt(semanalRows.reduce((s, r) => s + r.prodPeso, 0))}</td>
                <td className="table-td">{fmt(semanalRows.reduce((s, r) => s + r.despachos, 0))}</td>
                <td className="table-td">{semanalRows.reduce((s, r) => s + r.dias, 0)}</td>
                <td className="table-td">–</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

function KpiCard({ label, value, unit, color }: {
  label: string; value: string; unit: string; color: string;
}) {
  const colors: Record<string, string> = {
    green: "text-green-600", orange: "text-orange-600",
    blue: "text-blue-600",   purple: "text-purple-600",
  };
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${colors[color]}`}>{value}</span>
      <span className="text-xs text-gray-400">{unit}</span>
    </div>
  );
}
