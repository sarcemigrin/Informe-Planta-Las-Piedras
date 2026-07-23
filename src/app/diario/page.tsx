"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useViewerMode } from "@/hooks/useViewerMode";
import {
  format, eachDayOfInterval, getDay, isBefore, isToday,
  addMonths, subMonths, startOfMonth, endOfMonth, startOfDay,
  parseISO, getISOWeek, startOfISOWeek, endOfISOWeek,
} from "date-fns";
import { es } from "date-fns/locale";

const PLANTAS = [
  { key: "turco",   label: "El Turco",    color: "#f59e0b", bg: "#fffbeb", textColor: "#92400e", scheduledDow: [1,3,5] as number[], freqLabel: "3×/sem" },
  { key: "peral",   label: "El Peral",    color: "#06b6d4", bg: "#ecfeff", textColor: "#155e75", scheduledDow: [3,6]     as number[], freqLabel: "2×/sem" },
  { key: "piedras", label: "Las Piedras", color: "#22c55e", bg: "#f0fdf4", textColor: "#166534", scheduledDow: [1,2,3,4,5] as number[], freqLabel: "5×/sem" },
];
type PlantaKey = "turco" | "peral" | "piedras";

interface VuelosData { turco: string[]; peral: string[]; piedras: string[]; }
interface Anotacion  { fecha: string; planta: string; motivo: string; }
type AnotMap = Map<string, string>;
const anotKey = (fecha: string, planta: string) => `${fecha}|${planta}`;

export default function DiarioPage() {
  const { data: session } = useSession();
  const { viewerMode }    = useViewerMode();
  const isAdmin = session?.user?.rol === "admin" && !viewerMode;

  const [loading, setLoading] = useState(true);
  const [vuelos, setVuelos]   = useState<VuelosData>({ turco: [], peral: [], piedras: [] });
  const [anots, setAnots]     = useState<AnotMap>(new Map());
  const [calMes, setCalMes]   = useState(() => startOfMonth(new Date()));

  const [modalFecha,     setModalFecha]     = useState<string | null>(null);
  const [modalPlanta,    setModalPlanta]    = useState<PlantaKey>("turco");
  const [modalMotivo,    setModalMotivo]    = useState("");
  const [modalGuardando, setModalGuardando] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const anio = new Date().getFullYear();
    const [vRes, aRes] = await Promise.all([
      fetch("/api/vuelos"),
      fetch(`/api/anotaciones-vuelos?anio=${anio}`),
    ]);
    if (vRes.ok) setVuelos(await vRes.json());
    if (aRes.ok) {
      const data: Anotacion[] = await aRes.json();
      const map: AnotMap = new Map();
      data.forEach((a) => map.set(anotKey(a.fecha, a.planta), a.motivo));
      setAnots(map);
    }
    setLoading(false);
  }

  async function guardarAnotacion() {
    if (!modalFecha || !modalMotivo.trim()) return;
    setModalGuardando(true);
    try {
      const res = await fetch("/api/anotaciones-vuelos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha: modalFecha, planta: modalPlanta, motivo: modalMotivo.trim() }),
      });
      if (!res.ok) { alert("Error al guardar"); return; }
      setAnots((prev) => {
        const next = new Map(prev);
        next.set(anotKey(modalFecha!, modalPlanta), modalMotivo.trim());
        return next;
      });
      setModalFecha(null);
      setModalMotivo("");
    } finally {
      setModalGuardando(false);
    }
  }

  // ── Lookup sets ──────────────────────────────────────────────────────────
  const sets: Record<PlantaKey, Set<string>> = {
    turco:   new Set(vuelos.turco),
    peral:   new Set(vuelos.peral),
    piedras: new Set(vuelos.piedras),
  };

  const mesKey = format(calMes, "yyyy-MM");
  const hoy    = startOfDay(new Date());

  // Días programados transcurridos en el mes para una planta
  function diasProgramadosMes(scheduledDow: number[]) {
    const start  = startOfMonth(calMes);
    const end    = endOfMonth(calMes);
    const limite = isBefore(end, hoy) ? end : hoy;
    if (isBefore(limite, start)) return 0;
    return eachDayOfInterval({ start, end: limite })
      .filter((d) => scheduledDow.includes(d.getDay())).length;
  }

  // ── Semanas del mes para la tabla ────────────────────────────────────────
  interface WeekRow {
    label:   string;
    start:   Date;
    end:     Date;
    counts:  Record<PlantaKey, { real: number; prog: number }>;
  }

  const weekRows: WeekRow[] = (() => {
    const mesStart = startOfMonth(calMes);
    const mesEnd   = endOfMonth(calMes);
    const days     = eachDayOfInterval({ start: mesStart, end: mesEnd });
    const semanas  = new Map<number, Date[]>();
    days.forEach((d) => {
      const w = getISOWeek(d);
      if (!semanas.has(w)) semanas.set(w, []);
      semanas.get(w)!.push(d);
    });
    return Array.from(semanas.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, dias]) => {
        const wStart = dias[0];
        const wEnd   = dias[dias.length - 1];
        const limite = isBefore(wEnd, hoy) ? wEnd : (isBefore(hoy, wStart) ? null : hoy);
        const counts = {} as Record<PlantaKey, { real: number; prog: number }>;
        for (const p of PLANTAS) {
          const prog = limite
            ? dias.filter((d) => p.scheduledDow.includes(d.getDay()) && !isBefore(hoy, startOfDay(d))).length
            : 0;
          const real = dias.filter((d) => p.scheduledDow.includes(d.getDay()) && sets[p.key as PlantaKey].has(format(d, "yyyy-MM-dd"))).length;
          counts[p.key as PlantaKey] = { real, prog };
        }
        return {
          label:  `${format(wStart, "d")}–${format(wEnd, "d MMM", { locale: es })}`,
          start:  wStart,
          end:    wEnd,
          counts,
        };
      }).reverse();
  })();

  // ── Incidencias del mes ──────────────────────────────────────────────────
  interface Incidencia {
    fecha:   string;
    planta:  PlantaKey;
    motivo?: string;
  }
  const incidencias: Incidencia[] = (() => {
    const start  = startOfMonth(calMes);
    const end    = endOfMonth(calMes);
    const limite = isBefore(end, hoy) ? end : hoy;
    if (isBefore(limite, start)) return [];
    const result: Incidencia[] = [];
    eachDayOfInterval({ start, end: limite }).forEach((d) => {
      const key = format(d, "yyyy-MM-dd");
      for (const p of PLANTAS) {
        if (p.scheduledDow.includes(d.getDay()) && !sets[p.key as PlantaKey].has(key)) {
          result.push({ fecha: key, planta: p.key as PlantaKey, motivo: anots.get(anotKey(key, p.key)) });
        }
      }
    });
    return result.sort((a, b) => b.fecha.localeCompare(a.fecha));
  })();

  // ── Calendario ───────────────────────────────────────────────────────────
  const sabadoEsLaboral = PLANTAS.some((p) => p.scheduledDow.includes(6));
  function esFinde(d: Date) {
    const dow = d.getDay();
    return dow === 0 || (dow === 6 && !sabadoEsLaboral);
  }
  function esFuturo(d: Date) { return isBefore(hoy, startOfDay(d)) && !isToday(d); }

  const calDays: (Date | null)[] = (() => {
    const start    = startOfMonth(calMes);
    const end      = endOfMonth(calMes);
    const startDow = (getDay(start) + 6) % 7;
    const days: (Date | null)[] = Array<null>(startDow).fill(null);
    eachDayOfInterval({ start, end }).forEach((d) => days.push(d));
    return days;
  })();

  function abrirModal(d: Date, planta?: PlantaKey) {
    if (!isAdmin || esFuturo(d)) return;
    const key = format(d, "yyyy-MM-dd");
    const p   = planta ?? "turco";
    setModalFecha(key);
    setModalPlanta(p);
    setModalMotivo(anots.get(anotKey(key, p)) ?? "");
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-6">

      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Control Vuelos</h1>
          <p className="text-sm text-gray-500">Seguimiento de frecuencia de droneos</p>
        </div>
        <div className="flex gap-1">
          <button className="btn-secondary text-xs px-3 py-1" onClick={() => setCalMes((m) => subMonths(m, 1))}>‹</button>
          <span className="btn-secondary text-xs px-4 py-1 capitalize pointer-events-none">
            {format(calMes, "MMMM yyyy", { locale: es })}
          </span>
          <button className="btn-secondary text-xs px-3 py-1" onClick={() => setCalMes((m) => addMonths(m, 1))}>›</button>
        </div>
      </div>

      {/* ── Acumulado mensual — barras de progreso ── */}
      <div className="card space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Acumulado mensual — {format(calMes, "MMMM yyyy", { locale: es })}
        </p>
        {PLANTAS.map((p) => {
          const realizados  = [...sets[p.key as PlantaKey]].filter((f) => f.startsWith(mesKey)).length;
          const programados = diasProgramadosMes(p.scheduledDow);
          const pct         = programados > 0 ? Math.round((realizados / programados) * 100) : 0;
          const color       = pct >= 90 ? p.color : pct >= 70 ? "#f59e0b" : "#ef4444";
          return (
            <div key={p.key} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-28 flex-shrink-0">
                <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="text-xs font-medium text-gray-700">{p.label}</span>
              </div>
              <div className="flex-1 h-6 bg-gray-100 rounded-md overflow-hidden relative">
                <div
                  className="h-full rounded-md flex items-center px-2 transition-all"
                  style={{ width: `${Math.max(pct, 8)}%`, background: color }}
                >
                  <span className="text-white text-[10px] font-semibold whitespace-nowrap">
                    {realizados} / {programados}
                  </span>
                </div>
              </div>
              <span className="text-xs font-semibold w-10 text-right" style={{ color }}>
                {pct}%
              </span>
              <span className="text-[10px] text-gray-400 w-12 flex-shrink-0">{p.freqLabel}</span>
            </div>
          );
        })}
      </div>

      {/* ── Calendario semáforo ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Semáforo diario</p>
          <div className="flex items-center gap-4 text-[10px] text-gray-400">
            <span>Encendido = realizado</span>
            <span>Tenue = día programado sin droneo</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {["L","M","X","J","V","S","D"].map((d) => (
            <div key={d} className="text-center text-[10px] text-gray-300 font-medium py-0.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {calDays.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const key    = format(d, "yyyy-MM-dd");
            const futuro = esFuturo(d);
            const finde  = esFinde(d);
            const hoyDia = isToday(d);
            const tieneNota = PLANTAS.some((p) => anots.has(anotKey(key, p.key)));
            return (
              <div
                key={key}
                onClick={() => abrirModal(d)}
                className={`rounded flex flex-col items-center py-1.5 gap-1 select-none transition-colors
                  ${finde ? "bg-gray-50" : ""}
                  ${futuro ? "opacity-25" : ""}
                  ${!futuro && isAdmin ? "cursor-pointer hover:bg-gray-50" : ""}
                  ${hoyDia ? "ring-1 ring-migrin ring-offset-0" : ""}
                `}
              >
                <span className={`text-[10px] font-medium ${hoyDia ? "text-migrin" : finde ? "text-gray-300" : "text-gray-400"}`}>
                  {format(d, "d")}
                </span>
                {!futuro && (
                  <div className="flex gap-0.5">
                    {PLANTAS.map((p) => {
                      const on       = sets[p.key as PlantaKey].has(key);
                      const sched    = p.scheduledDow.includes(d.getDay());
                      const opacity  = on ? 1 : sched ? 0.2 : 0.05;
                      return (
                        <span key={p.key} className="inline-block rounded-full"
                          style={{ width: 9, height: 9, background: p.color, opacity }} />
                      );
                    })}
                  </div>
                )}
                {tieneNota && !futuro && (
                  <span className="w-1 h-1 rounded-full bg-amber-400" />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 pt-2 border-t border-gray-50">
          {PLANTAS.map((p) => (
            <div key={p.key} className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
              {p.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabla semanal ── */}
      <div className="card overflow-auto">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Cumplimiento semanal</p>
        <table className="w-full text-sm min-w-[480px]">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Semana</th>
              {PLANTAS.map((p) => (
                <th key={p.key} className="table-th text-center">
                  <span className="flex items-center justify-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
                    <span>{p.label}</span>
                    <span className="text-gray-300 font-normal">({p.freqLabel})</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {weekRows.map((w) => {
              const isFuture = isBefore(hoy, startOfDay(w.start));
              return (
                <tr key={w.label} className={`hover:bg-gray-50 ${isFuture ? "opacity-40" : ""}`}>
                  <td className="table-td-left text-gray-500 text-xs">{w.label}</td>
                  {PLANTAS.map((p) => {
                    const { real, prog } = w.counts[p.key as PlantaKey];
                    const ok = real >= prog && prog > 0;
                    const pct = prog > 0 ? Math.round((real / prog) * 100) : null;
                    return (
                      <td key={p.key} className="table-td text-center">
                        {isFuture ? (
                          <span className="text-gray-200 text-xs">—</span>
                        ) : prog === 0 ? (
                          <span className="text-gray-200 text-xs">—</span>
                        ) : (
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
                            style={{
                              background: ok ? p.bg : real === 0 ? "#fee2e2" : "#fef9c3",
                              color: ok ? p.textColor : real === 0 ? "#991b1b" : "#92400e",
                            }}
                          >
                            {real}/{prog}
                            {pct !== null && pct < 100 && <span className="font-normal ml-1 opacity-70">{pct}%</span>}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>


      {/* ── Modal ── */}
      {modalFecha && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setModalFecha(null)}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-1">Justificación de vuelo</h3>
            <p className="text-sm text-gray-500 mb-4">{modalFecha}</p>
            <div className="mb-3">
              <label className="label mb-1">Planta</label>
              <div className="flex gap-2">
                {PLANTAS.map((p) => (
                  <button key={p.key}
                    onClick={() => {
                      setModalPlanta(p.key as PlantaKey);
                      setModalMotivo(anots.get(anotKey(modalFecha!, p.key)) ?? "");
                    }}
                    className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors"
                    style={modalPlanta === p.key
                      ? { background: p.color, borderColor: p.color, color: "#fff" }
                      : { background: "#fff", borderColor: "#e5e7eb", color: "#6b7280" }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="label mb-1">Motivo</label>
            <textarea className="input w-full" rows={3}
              placeholder="Ej: Lluvia, Mantención equipo, Sin personal..."
              value={modalMotivo}
              onChange={(e) => setModalMotivo(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setModalFecha(null)}>Cancelar</button>
              <button className="btn-primary text-sm" onClick={guardarAnotacion}
                disabled={!modalMotivo.trim() || modalGuardando}>
                {modalGuardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
