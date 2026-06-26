"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena } from "@/types/database";
import { format, eachDayOfInterval, parseISO, getISOWeek } from "date-fns";
import { es } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

interface DiaRow {
  fecha:         Date;
  semana:        number;
  mes:           number;
  anio:          number;
  esDroneo:      boolean;
  // Totales (solo días droneo)
  prodDroneTotal:   number;
  despachosTotal:   number;
  horasTotal:       number;
  fierrilloTotal:   number;
  // Por día
  prodDroneDia:     number;
  despachosDia:     number;
  horasDia:         number;
  productividad:    number;
  productividadReal:number;
  fierrilloDia:     number;
}

export default function DiarioPage() {
  const [rows, setRows]     = useState<DiaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroMes, setFiltroMes] = useState<string>("");
  const [vista, setVista]   = useState<"tabla"|"grafico">("tabla");

  useEffect(() => {
    loadDiario();
  }, []);

  async function loadDiario() {
    // Cargar registros arena
    const { data: arena } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: true });

    if (!arena || arena.length < 2) { setLoading(false); return; }

    const dias: DiaRow[] = [];

    for (let i = 1; i < arena.length; i++) {
      const curr = arena[i];
      const prev = arena[i - 1];

      const fechaCurr = parseISO(curr.fecha);
      const fechaPrev = parseISO(prev.fecha);

      const intervalo = eachDayOfInterval({ start: addDays(fechaPrev, 1), end: fechaCurr });
      const diasPeriodo = Math.max(intervalo.length, 1);

      for (const dia of intervalo) {
        const esDroneo = dia.getTime() === fechaCurr.getTime();
        dias.push({
          fecha:    dia,
          semana:   getISOWeek(dia),
          mes:      dia.getMonth() + 1,
          anio:     dia.getFullYear(),
          esDroneo,
          prodDroneTotal:   esDroneo ? (curr.produccion_drone ?? 0) : 0,
          despachosTotal:   esDroneo ? (curr.despachos_ton ?? 0) : 0,
          horasTotal:       esDroneo ? (curr.horas_reales ?? 0) : 0,
          fierrilloTotal:   esDroneo ? (curr.fierrillo ?? 0) : 0,
          prodDroneDia:     (curr.produccion_drone ?? 0) / diasPeriodo,
          despachosDia:     (curr.despachos_ton ?? 0) / diasPeriodo,
          horasDia:         (curr.horas_reales ?? 0) / diasPeriodo,
          productividad:    curr.productividad_drone ?? 0,
          productividadReal:curr.productividad_hrs_reales ?? 0,
          fierrilloDia:     (curr.fierrillo ?? 0) / diasPeriodo,
        });
      }
    }

    setRows(dias.reverse()); // más reciente primero
    setLoading(false);
  }

  const meses = [...new Set(rows.map((r) => `${r.anio}-${String(r.mes).padStart(2,"0")}`))].sort().reverse();
  const filtrados = rows.filter((r) =>
    !filtroMes || `${r.anio}-${String(r.mes).padStart(2,"0")}` === filtroMes
  );

  // Datos para gráfico (últimos 30 días)
  const chartData = [...filtrados].reverse().slice(-30).map((r) => ({
    fecha:     format(r.fecha, "dd/MM"),
    prodDrone: +r.prodDroneDia.toFixed(2),
    despachos: +r.despachosDia.toFixed(2),
  }));

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold"> Vista Diaria (Arena)</h1>
          <p className="text-sm text-gray-500">
            Días de droneo: valores reales. Días intermedios: promedio del período distribuido.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="input w-40"
            value={filtroMes}
            onChange={(e) => setFiltroMes(e.target.value)}
          >
            <option value="">Todos los meses</option>
            {meses.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            className={`btn-secondary text-xs py-1.5 ${vista==="tabla" ? "bg-green-50 text-migrin-dark border-green-400" : ""}`}
            onClick={() => setVista("tabla")}
          >Tabla</button>
          <button
            className={`btn-secondary text-xs py-1.5 ${vista==="grafico" ? "bg-green-50 text-migrin-dark border-green-400" : ""}`}
            onClick={() => setVista("grafico")}
          >Gráfico</button>
        </div>
      </div>

      {vista === "grafico" && chartData.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4">Producción diaria (ton/día)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top:5, right:20, left:10, bottom:5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="fecha" tick={{ fontSize:10 }} />
              <YAxis tick={{ fontSize:10 }} />
              <Tooltip formatter={(v) => fmt(v as number) + " ton"} />
              <Legend />
              <Bar dataKey="prodDrone" name="Prod. Drone" fill="#22c55e" radius={[3,3,0,0]} />
              <Bar dataKey="despachos" name="Despachos"   fill="#f97316" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {vista === "tabla" && (
        <div className="card overflow-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="table-th text-left">Fecha</th>
                <th className="table-th">Sem</th>
                <th className="table-th">Droneo</th>
                <th className="table-th">Prod. Drone/día</th>
                <th className="table-th">Despachos/día</th>
                <th className="table-th">Horas/día</th>
                <th className="table-th">Productividad</th>
                <th className="table-th">Fierrillo/día</th>
                <th className="table-th">Prod. Total</th>
                <th className="table-th">Despachos Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtrados.map((r, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${r.esDroneo ? "bg-green-50" : ""}`}>
                  <td className="table-td-left font-medium">
                    {format(r.fecha, "EEE dd/MM/yyyy", { locale: es })}
                  </td>
                  <td className="table-td text-gray-400">S{r.semana}</td>
                  <td className="table-td text-center">
                    {r.esDroneo ? <span className="text-migrin font-bold"></span> : ""}
                  </td>
                  <td className="table-td text-green-700 font-semibold">{fmt(r.prodDroneDia)}</td>
                  <td className="table-td">{fmt(r.despachosDia)}</td>
                  <td className="table-td">{fmt(r.horasDia, 1)}</td>
                  <td className="table-td">{fmt(r.productividad)} t/h</td>
                  <td className="table-td text-gray-400">{fmt(r.fierrilloDia)}</td>
                  <td className="table-td text-blue-700">{r.esDroneo ? fmt(r.prodDroneTotal) : "–"}</td>
                  <td className="table-td">{r.esDroneo ? fmt(r.despachosTotal) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
