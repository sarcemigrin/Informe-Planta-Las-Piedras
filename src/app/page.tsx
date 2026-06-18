"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena, RegistroCuarzo } from "@/types/database";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function Dashboard() {
  const [arenaRows, setArenaRows] = useState<RegistroArena[]>([]);
  const [cuarzoRows, setCuarzoRows] = useState<RegistroCuarzo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: arena }, { data: cuarzo }] = await Promise.all([
        supabase
          .from("registros_arena")
          .select("*")
          .order("fecha_hora", { ascending: false })
          .limit(30),
        supabase
          .from("registros_cuarzo")
          .select("*")
          .order("fecha_hora", { ascending: false })
          .limit(10),
      ]);
      setArenaRows(arena ?? []);
      setCuarzoRows(cuarzo ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const ultimoArena  = arenaRows[0];
  const ultimoCuarzo = cuarzoRows[0];

  // Datos para gráfico: últimos 12 registros arena
  const chartData = [...arenaRows].reverse().slice(-12).map((r) => ({
    fecha:    format(new Date(r.fecha), "dd/MM", { locale: es }),
    drone:    r.produccion_drone,
    pesometro:r.produccion_pesometro,
    inv:      r.inventario_ton,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Cargando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Planta Las Piedras – Producción Arena &amp; Cuarzo</p>
        </div>
        <div className="flex gap-2">
          <Link href="/arena"  className="btn-primary">+ Arena</Link>
          <Link href="/cuarzo" className="btn-secondary">+ Cuarzo</Link>
        </div>
      </div>

      {/* Stats Arena */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Último droneo Arena — {ultimoArena ? format(new Date(ultimoArena.fecha), "dd/MM/yyyy") : "Sin datos"}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Inventario" value={fmt(ultimoArena?.inventario_ton)} unit="ton" color="blue" />
          <StatCard label="Prod. Drone" value={fmt(ultimoArena?.produccion_drone)} unit="ton" color="green" />
          <StatCard label="Prod. Pesómetro" value={fmt(ultimoArena?.produccion_pesometro)} unit="ton" color="orange" />
          <StatCard label="Productividad" value={fmt(ultimoArena?.productividad_drone)} unit="ton/h" color="purple" />
          <StatCard label="Despachos" value={fmt(ultimoArena?.despachos_ton)} unit="ton" color="gray" />
          <StatCard label="Cancha Nueva" value={fmt(ultimoArena?.cancha_nueva_ton)} unit="ton" color="yellow" />
        </div>
      </section>

      {/* Stats Cuarzo */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Último droneo Cuarzo — {ultimoCuarzo ? format(new Date(ultimoCuarzo.fecha), "dd/MM/yyyy") : "Sin datos"}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard label="Inventario" value={fmt(ultimoCuarzo?.inventario_ton)} unit="ton" color="blue" />
          <StatCard label="Prod. Drone" value={fmt(ultimoCuarzo?.produccion_drone)} unit="ton" color="green" />
          <StatCard label="Productividad" value={fmt(ultimoCuarzo?.productividad_drone)} unit="ton/h" color="orange" />
          <StatCard label="Despachos" value={fmt(ultimoCuarzo?.despachos_ton)} unit="ton" color="gray" />
        </div>
      </section>

      {/* Gráfico producción arena */}
      {chartData.length > 0 && (
        <section className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Producción Arena (últimas mediciones)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmt(v as number) + " ton"} />
              <Legend />
              <Line type="monotone" dataKey="drone"     name="Drone"      stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="pesometro" name="Pesómetro"  stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="inv"       name="Inventario" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Últimos registros Arena */}
      <section className="card overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Registros Arena recientes</h2>
          <Link href="/informe" className="text-sm text-orange-600 hover:underline">Ver informe →</Link>
        </div>
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Pesómetro</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Prod. Peso</th>
              <th className="table-th">Inventario</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Productividad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {arenaRows.slice(0, 8).map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="table-td-left font-medium">
                  {format(new Date(r.fecha), "dd/MM/yyyy")} {r.hora.slice(0,5)}
                </td>
                <td className="table-td">{r.pesometro?.toLocaleString("es-CL")}</td>
                <td className="table-td text-green-700 font-semibold">{fmt(r.produccion_drone)}</td>
                <td className="table-td text-orange-600">{fmt(r.produccion_pesometro)}</td>
                <td className="table-td text-blue-700">{fmt(r.inventario_ton)}</td>
                <td className="table-td">{fmt(r.despachos_ton)}</td>
                <td className="table-td">{fmt(r.productividad_drone)} t/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatCard({
  label, value, unit, color,
}: {
  label: string; value: string; unit: string; color: string;
}) {
  const colors: Record<string, string> = {
    blue:   "text-blue-600",
    green:  "text-green-600",
    orange: "text-orange-600",
    purple: "text-purple-600",
    gray:   "text-gray-600",
    yellow: "text-yellow-600",
  };
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${colors[color] ?? "text-gray-900"}`}>{value}</span>
      <span className="text-xs text-gray-400">{unit}</span>
    </div>
  );
}
