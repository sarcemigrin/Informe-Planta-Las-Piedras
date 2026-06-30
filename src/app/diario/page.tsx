"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena } from "@/types/database";
import {
  format, eachDayOfInterval, parseISO, getISOWeek,
  startOfMonth, endOfMonth, getDay, isBefore, isToday,
  addMonths, subMonths, startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const TABLE_PAGE = 10;

interface DiaRow {
  fecha:            Date;
  semana:           number;
  mes:              number;
  anio:             number;
  esDroneo:         boolean;
  prodDroneTotal:   number;
  despachosTotal:   number;
  horasTotal:       number;
  fierrilloTotal:   number;
  prodDroneDia:     number;
  despachosDia:     number;
  horasDia:         number;
  productividad:    number;
  productividadReal:number;
  fierrilloDia:     number;
}

interface Anotacion {
  fecha:  string;
  motivo: string;
}

export default function DiarioPage() {
  const [rows, setRows]         = useState<DiaRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filtroMes, setFiltroMes] = useState<string>("");
  const [vista, setVista]       = useState<"tabla" | "grafico">("tabla");
  const [tablePage, setTablePage] = useState(1);

  // Calendario
  const [calMes, setCalMes]         = useState(() => startOfMonth(new Date()));
  const [anotaciones, setAnotaciones] = useState<Map<string, string>>(new Map());
  const [droneoDias, setDroneoDias]   = useState<Set<string>>(new Set());

  // Modal anotación
  const [modalFecha, setModalFecha]   = useState<string | null>(null);
  const [modalMotivo, setModalMotivo] = useState("");
  const [modalGuardando, setModalGuardando] = useState(false);

  useEffect(() => {
    loadDiario();
    loadAnotaciones();
  }, []);

  async function loadDiario() {
    const { data: arena } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: true });

    if (!arena || arena.length < 2) { setLoading(false); return; }

    const dias: DiaRow[] = [];
    const droneo = new Set<string>();

    for (let i = 1; i < arena.length; i++) {
      const curr = arena[i];
      const prev = arena[i - 1];

      const fechaCurr = parseISO(curr.fecha);
      const fechaPrev = parseISO(prev.fecha);

      const intervalo  = eachDayOfInterval({ start: addDays(fechaPrev, 1), end: fechaCurr });
      const diasPeriodo = Math.max(intervalo.length, 1);

      for (const dia of intervalo) {
        const esDroneo = dia.getTime() === fechaCurr.getTime();
        if (esDroneo) droneo.add(format(dia, "yyyy-MM-dd"));
        dias.push({
          fecha:    dia,
          semana:   getISOWeek(dia),
          mes:      dia.getMonth() + 1,
          anio:     dia.getFullYear(),
          esDroneo,
          prodDroneTotal:   esDroneo ? (curr.produccion_drone   ?? 0) : 0,
          despachosTotal:   esDroneo ? (curr.despachos_ton      ?? 0) : 0,
          horasTotal:       esDroneo ? (curr.horas_reales       ?? 0) : 0,
          fierrilloTotal:   esDroneo ? (curr.fierrillo          ?? 0) : 0,
          prodDroneDia:     (curr.produccion_drone ?? 0) / diasPeriodo,
          despachosDia:     (curr.despachos_ton    ?? 0) / diasPeriodo,
          horasDia:         (curr.horas_reales     ?? 0) / diasPeriodo,
          productividad:    curr.productividad_drone        ?? 0,
          productividadReal:curr.productividad_hrs_reales   ?? 0,
          fierrilloDia:     (curr.fierrillo ?? 0) / diasPeriodo,
        });
      }
    }

    setDroneoDias(droneo);
    setRows(dias.reverse());
    setLoading(false);
  }

  async function loadAnotaciones() {
    try {
      const { data } = await supabase
        .from("anotaciones_diario")
        .select("fecha, motivo");
      if (data) {
        const map = new Map<string, string>();
        data.forEach((a: Anotacion) => map.set(a.fecha, a.motivo));
        setAnotaciones(map);
      }
    } catch {
      // Tabla puede no existir aún — se ignora silenciosamente
    }
  }

  async function guardarAnotacion() {
    if (!modalFecha || !modalMotivo.trim()) return;
    setModalGuardando(true);
    try {
      await supabase.from("anotaciones_diario").upsert(
        { fecha: modalFecha, motivo: modalMotivo.trim() },
        { onConflict: "fecha" }
      );
      setAnotaciones((prev) => new Map(prev).set(modalFecha, modalMotivo.trim()));
    } finally {
      setModalGuardando(false);
      setModalFecha(null);
      setModalMotivo("");
    }
  }

  // ---- Datos tabla / gráfico ----
  const meses = [...new Set(rows.map((r) => `${r.anio}-${String(r.mes).padStart(2, "0")}`))].sort().reverse();
  const filtrados = rows.filter((r) =>
    !filtroMes || `${r.anio}-${String(r.mes).padStart(2, "0")}` === filtroMes
  );
  const totalTablePages = Math.ceil(filtrados.length / TABLE_PAGE);
  const paginados = filtrados.slice((tablePage - 1) * TABLE_PAGE, tablePage * TABLE_PAGE);

  const chartData = [...filtrados].reverse().slice(-30).map((r) => ({
    fecha:     format(r.fecha, "dd/MM"),
    prodDrone: +r.prodDroneDia.toFixed(1),
    despachos: +r.despachosDia.toFixed(1),
  }));

  // ---- Calendario ----
  const calDays = (() => {
    const start = startOfMonth(calMes);
    const end   = endOfMonth(calMes);
    // lunes = 0, domingo = 6
    const startDow = (getDay(start) + 6) % 7; // ajuste a lunes primero
    const blanks = Array(startDow).fill(null);
    const days: (Date | null)[] = [...blanks];
    eachDayOfInterval({ start, end }).forEach((d) => days.push(d));
    return days;
  })();

  const hoy = startOfDay(new Date());

  function esFindeSemana(d: Date): boolean {
    const dow = d.getDay(); // 0=dom, 6=sáb
    return dow === 0 || dow === 6;
  }

  function calClass(d: Date): string {
    const key    = format(d, "yyyy-MM-dd");
    const futuro = isBefore(hoy, startOfDay(d)) && !isToday(d);
    if (futuro) return "cal-day-futuro";
    if (droneoDias.has(key)) return "cal-day-droneo";
    if (esFindeSemana(d)) return "cal-day-finde";
    if (anotaciones.has(key)) return "cal-day-anotado";
    if (isBefore(startOfDay(d), hoy) || isToday(d)) return "cal-day-sin";
    return "";
  }

  function abrirModal(d: Date) {
    const key    = format(d, "yyyy-MM-dd");
    const futuro = isBefore(hoy, startOfDay(d)) && !isToday(d);
    if (futuro || droneoDias.has(key) || esFindeSemana(d)) return;
    setModalFecha(key);
    setModalMotivo(anotaciones.get(key) ?? "");
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Control Vuelos</h1>
          <p className="text-sm text-gray-500">
            Días de droneo: valores reales. Días intermedios: promedio del período distribuido.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="input w-40"
            value={filtroMes}
            onChange={(e) => { setFiltroMes(e.target.value); setTablePage(1); }}
          >
            <option value="">Todos los meses</option>
            {meses.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            className={`btn-secondary text-xs py-1.5 ${vista === "tabla"   ? "bg-green-50 text-migrin-dark border-green-400" : ""}`}
            onClick={() => setVista("tabla")}
          >Tabla</button>
          <button
            className={`btn-secondary text-xs py-1.5 ${vista === "grafico" ? "bg-green-50 text-migrin-dark border-green-400" : ""}`}
            onClick={() => setVista("grafico")}
          >Gráfico</button>
        </div>
      </div>

      {/* ---- Calendario ---- */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-700 capitalize">
            {format(calMes, "MMMM yyyy", { locale: es })}
          </h2>
          <div className="flex gap-1">
            <button
              className="btn-secondary text-xs px-3 py-1"
              onClick={() => setCalMes((m) => subMonths(m, 1))}
            >‹</button>
            <button
              className="btn-secondary text-xs px-3 py-1"
              onClick={() => setCalMes((m) => addMonths(m, 1))}
            >›</button>
          </div>
        </div>

        {/* Días de semana */}
        <div className="grid grid-cols-7 gap-0.5 mb-0.5">
          {["L","M","X","J","V","S","D"].map((d) => (
            <div key={d} className="text-center text-[10px] text-gray-400 font-medium py-0.5">{d}</div>
          ))}
        </div>

        {/* Celdas del calendario — compactas */}
        <div className="grid grid-cols-7 gap-0.5">
          {calDays.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const key    = format(d, "yyyy-MM-dd");
            const cls    = calClass(d);
            const nota   = anotaciones.get(key);
            const futuro = cls === "cal-day-futuro";
            return (
              <div
                key={key}
                onClick={() => !futuro && abrirModal(d)}
                title={nota ? `Anotación: ${nota}` : cls === "cal-day-droneo" ? "Día de droneo" : "Sin droneo — click para anotar"}
                className={`
                  flex flex-col items-center justify-center rounded py-1 text-[11px] font-medium
                  border border-transparent transition-colors select-none
                  ${cls === "cal-day-droneo" ? "bg-green-100 text-green-800" : ""}
                  ${cls === "cal-day-sin"    ? "bg-red-50 text-red-700 cursor-pointer hover:border-red-300" : ""}
                  ${cls === "cal-day-anotado"? "bg-amber-100 text-amber-800 cursor-pointer hover:border-amber-400" : ""}
                  ${cls === "cal-day-finde"  ? "bg-gray-100 text-gray-400" : ""}
                  ${cls === "cal-day-futuro" ? "text-gray-300" : ""}
                  ${!cls ? "text-gray-500 cursor-pointer hover:bg-gray-50" : ""}
                `}
              >
                {format(d, "d")}
                {cls === "cal-day-droneo"  && <span className="w-1 h-1 rounded-full bg-green-500 mt-0.5" />}
                {cls === "cal-day-sin"     && <span className="w-1 h-1 rounded-full bg-red-400 mt-0.5" />}
                {cls === "cal-day-anotado" && <span className="w-1 h-1 rounded-full bg-amber-500 mt-0.5" />}
              </div>
            );
          })}
        </div>

        {/* Leyenda */}
        <div className="flex gap-4 flex-wrap mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-300" />Droneo
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-50 border border-red-200" />Sin droneo
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" />Con anotación
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" />Fin de semana
          </div>
          <span className="text-xs text-gray-400">Click en días sin droneo para agregar motivo</span>
        </div>
      </div>

      {/* ---- Gráfico ---- */}
      {vista === "grafico" && chartData.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4">Producción diaria (ton/día)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => fmt(v as number) + " ton"} />
              <Legend />
              <Bar dataKey="prodDrone" name="Prod. Drone" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="despachos" name="Despachos"   fill="#f97316" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ---- Tabla ---- */}
      {vista === "tabla" && (
        <div className="card overflow-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="table-th text-left">Fecha</th>
                <th className="table-th">Sem</th>
                <th className="table-th">Droneo</th>
                <th className="table-th">Productividad</th>
                <th className="table-th">Producción</th>
                <th className="table-th">Prod. Total</th>
                <th className="table-th">Horas/día</th>
                <th className="table-th">Fierrillo/día</th>
                <th className="table-th">Despachos/día</th>
                <th className="table-th">Despachos Total</th>
                <th className="table-th">Anotación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginados.map((r, i) => {
                const key  = format(r.fecha, "yyyy-MM-dd");
                const nota = anotaciones.get(key);
                return (
                  <tr key={i} className={`hover:bg-gray-50 ${r.esDroneo ? "bg-green-50/60" : ""}`}>
                    <td className="table-td-left font-medium text-gray-800">
                      {format(r.fecha, "EEE dd/MM/yyyy", { locale: es })}
                    </td>
                    <td className="table-td text-gray-400">S{r.semana}</td>
                    <td className="table-td text-center">
                      {r.esDroneo
                        ? <span className="text-green-600 font-bold text-base">✓</span>
                        : <span className="text-gray-300">–</span>}
                    </td>
                    <td className="table-td text-gray-800">{r.esDroneo ? `${fmt(r.productividad)} t/h` : "–"}</td>
                    <td className="table-td text-gray-800">{fmt(r.prodDroneDia)}</td>
                    <td className="table-td text-gray-800">{r.esDroneo ? fmt(r.prodDroneTotal) : "–"}</td>
                    <td className="table-td text-gray-800">{fmt(r.horasDia, 1)}</td>
                    <td className="table-td text-gray-800">{fmt(r.fierrilloDia)}</td>
                    <td className="table-td text-gray-800">{fmt(r.despachosDia)}</td>
                    <td className="table-td text-gray-800">{r.esDroneo ? fmt(r.despachosTotal) : "–"}</td>
                    <td className="table-td">
                      {esFindeSemana(r.fecha)
                        ? <span className="text-gray-400 text-xs">Fin de semana</span>
                        : nota
                          ? <span className="text-amber-700 text-xs font-medium">{nota}</span>
                          : !r.esDroneo
                            ? <button
                                onClick={() => abrirModal(r.fecha)}
                                className="text-gray-300 hover:text-migrin text-xs transition-colors"
                              >+ anotar</button>
                            : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Mostrando {(tablePage - 1) * TABLE_PAGE + 1}–{Math.min(tablePage * TABLE_PAGE, filtrados.length)} de {filtrados.length}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-secondary text-xs py-1 px-3"
                disabled={tablePage === 1}
                onClick={() => setTablePage((p) => p - 1)}
              >← Anterior</button>
              <button
                className="btn-secondary text-xs py-1 px-3"
                disabled={tablePage >= totalTablePages}
                onClick={() => setTablePage((p) => p + 1)}
              >Siguiente →</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Modal anotación ---- */}
      {modalFecha && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setModalFecha(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 mb-1">Anotación</h3>
            <p className="text-sm text-gray-500 mb-3">
              {modalFecha} — {anotaciones.has(modalFecha) ? "Editar motivo" : "¿Por qué no hubo droneo?"}
            </p>
            <textarea
              className="input w-full"
              rows={3}
              placeholder="Ej: Lluvia, Mantención equipo, Feriado..."
              value={modalMotivo}
              onChange={(e) => setModalMotivo(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setModalFecha(null)}>
                Cancelar
              </button>
              <button
                className="btn-primary text-sm"
                onClick={guardarAnotacion}
                disabled={!modalMotivo.trim() || modalGuardando}
              >
                {modalGuardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
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
