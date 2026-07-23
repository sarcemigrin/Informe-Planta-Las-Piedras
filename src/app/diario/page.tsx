"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useViewerMode } from "@/hooks/useViewerMode";
import {
  format, eachDayOfInterval, getDay, isBefore, isToday,
  addMonths, subMonths, startOfMonth, endOfMonth, startOfDay, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";

// ── Plantas con colores y días programados ──────────────────────────────────
// scheduledDow: 0=dom 1=lun 2=mar 3=mié 4=jue 5=vie 6=sáb
const PLANTAS = [
  { key: "turco",   label: "El Turco",    color: "#f59e0b", scheduledDow: [1,3,5,6] as number[] },
  { key: "peral",   label: "El Peral",    color: "#06b6d4", scheduledDow: [3,6]     as number[] },
  { key: "piedras", label: "Las Piedras", color: "#22c55e", scheduledDow: [1,2,3,4,5] as number[] },
];
type PlantaKey = "turco" | "peral" | "piedras";

interface VuelosData { turco: string[]; peral: string[]; piedras: string[]; }
interface Anotacion  { fecha: string; planta: string; motivo: string; }

// Mapa de anotaciones: "fecha|planta" → motivo
type AnotMap = Map<string, string>;
const anotKey = (fecha: string, planta: string) => `${fecha}|${planta}`;

export default function DiarioPage() {
  const { data: session } = useSession();
  const { viewerMode }    = useViewerMode();
  const isAdmin = session?.user?.rol === "admin" && !viewerMode;

  const [loading, setLoading]   = useState(true);
  const [vuelos, setVuelos]     = useState<VuelosData>({ turco: [], peral: [], piedras: [] });
  const [anots, setAnots]       = useState<AnotMap>(new Map());
  const [calMes, setCalMes]     = useState(() => startOfMonth(new Date()));

  // Modal
  const [modalFecha,    setModalFecha]    = useState<string | null>(null);
  const [modalPlanta,   setModalPlanta]   = useState<PlantaKey>("turco");
  const [modalMotivo,   setModalMotivo]   = useState("");
  const [modalGuardando,setModalGuardando]= useState(false);

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
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fecha: modalFecha, planta: modalPlanta, motivo: modalMotivo.trim() }),
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

  // ── KPIs del mes ─────────────────────────────────────────────────────────
  const mesKey = format(calMes, "yyyy-MM");
  function vuelosMes(key: PlantaKey) {
    return [...sets[key]].filter((f) => f.startsWith(mesKey)).length;
  }
  function diasProgramadosMes(scheduledDow: number[]) {
    const start  = startOfMonth(calMes);
    const end    = endOfMonth(calMes);
    const today  = startOfDay(new Date());
    const limite = isBefore(end, today) ? end : today;
    if (isBefore(limite, start)) return 0;
    return eachDayOfInterval({ start, end: limite })
      .filter((d) => scheduledDow.includes(d.getDay())).length;
  }

  // ── Helpers de calendario ────────────────────────────────────────────────
  const sabadoEsLaboral = PLANTAS.some((p) => p.scheduledDow.includes(6));
  function esFinde(d: Date) {
    const dow = d.getDay();
    return dow === 0 || (dow === 6 && !sabadoEsLaboral);
  }
  function esFuturo(d: Date) { return isBefore(hoy, startOfDay(d)) && !isToday(d); }

  const hoy = startOfDay(new Date());

  const calDays: (Date | null)[] = (() => {
    const start    = startOfMonth(calMes);
    const end      = endOfMonth(calMes);
    const startDow = (getDay(start) + 6) % 7;
    const days: (Date | null)[] = Array<null>(startDow).fill(null);
    eachDayOfInterval({ start, end }).forEach((d) => days.push(d));
    return days;
  })();

  function abrirModal(d: Date, planta?: PlantaKey) {
    if (!isAdmin || esFinde(d) || esFuturo(d)) return;
    const key = format(d, "yyyy-MM-dd");
    const p   = planta ?? "turco";
    setModalFecha(key);
    setModalPlanta(p);
    setModalMotivo(anots.get(anotKey(key, p)) ?? "");
  }

  // ── Días con datos para la tabla ─────────────────────────────────────────
  const allFechas = Array.from(
    new Set([...vuelos.turco, ...vuelos.peral, ...vuelos.piedras, ...[...anots.keys()].map((k) => k.split("|")[0])])
  ).filter((f) => f.startsWith(mesKey)).sort().reverse();

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-6">

      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Control Vuelos</h1>
          <p className="text-sm text-gray-500">Registro de droneos por planta</p>
        </div>
        <div className="flex gap-1">
          <button className="btn-secondary text-xs px-3 py-1" onClick={() => setCalMes((m) => subMonths(m, 1))}>‹</button>
          <span className="btn-secondary text-xs px-4 py-1 capitalize pointer-events-none">
            {format(calMes, "MMMM yyyy", { locale: es })}
          </span>
          <button className="btn-secondary text-xs px-3 py-1" onClick={() => setCalMes((m) => addMonths(m, 1))}>›</button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-3 gap-4">
        {PLANTAS.map((p) => {
          const realizados   = vuelosMes(p.key as PlantaKey);
          const programados  = diasProgramadosMes(p.scheduledDow);
          const noRealizados = Math.max(programados - realizados, 0);
          const pct          = programados > 0 ? Math.round((realizados / programados) * 100) : 0;
          return (
            <div key={p.key} className="card" style={{ borderLeft: `4px solid ${p.color}` }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="text-xs font-semibold text-gray-600">{p.label}</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: p.color }}>{realizados}</div>
              <div className="text-xs text-gray-500">
                {noRealizados > 0 ? `${noRealizados} sin droneo · ` : ""}{pct}% cumplimiento
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Leyenda ── */}
      <div className="flex items-center gap-5 flex-wrap text-xs text-gray-400">
        {PLANTAS.map((p) => (
          <div key={p.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: p.color }} />
            {p.label}
          </div>
        ))}
        <span className="text-gray-200">·</span>
        <span>Encendido = realizado · Tenue = día programado sin droneo</span>
      </div>

      {/* ── Calendario semáforo ── */}
      <div className="card">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map((d) => (
            <div key={d} className="text-center text-[10px] text-gray-400 font-medium py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
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
                className={`
                  rounded-lg flex flex-col items-center py-2 gap-1.5 select-none transition-colors
                  ${finde ? "bg-gray-50" : ""}
                  ${futuro ? "opacity-30" : ""}
                  ${!finde && !futuro && isAdmin ? "cursor-pointer hover:bg-gray-50" : ""}
                  ${hoyDia ? "ring-2 ring-migrin ring-offset-1" : ""}
                `}
              >
                <span className={`text-[11px] font-medium ${hoyDia ? "text-migrin" : finde ? "text-gray-300" : "text-gray-500"}`}>
                  {format(d, "d")}
                </span>
                {!futuro && (
                  <div className="flex gap-[3px]">
                    {PLANTAS.map((p) => {
                      const on        = sets[p.key as PlantaKey].has(key);
                      const scheduled = p.scheduledDow.includes(d.getDay());
                      const opacity   = on ? 1 : scheduled ? 0.18 : 0.05;
                      return (
                        <span
                          key={p.key}
                          className="inline-block rounded-full"
                          style={{ width: 11, height: 11, background: p.color, opacity }}
                        />
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
      </div>

      {/* ── Tabla de registros ── */}
      {allFechas.length > 0 && (
        <div className="card overflow-auto">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm">
            Registros — {format(calMes, "MMMM yyyy", { locale: es })}
          </h2>
          <table className="w-full text-sm min-w-[560px]">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="table-th text-left">Fecha</th>
                {PLANTAS.map((p) => (
                  <th key={p.key} className="table-th text-center">
                    <span className="flex items-center justify-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                      {p.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allFechas.map((fecha) => {
                const d = parseISO(fecha);
                return (
                  <tr key={fecha} className="hover:bg-gray-50">
                    <td className="table-td-left font-medium text-gray-700">
                      {format(d, "EEE dd/MM/yyyy", { locale: es })}
                    </td>
                    {PLANTAS.map((p) => {
                      const on    = sets[p.key as PlantaKey].has(fecha);
                      const nota  = anots.get(anotKey(fecha, p.key));
                      const sched = p.scheduledDow.includes(d.getDay());
                      return (
                        <td key={p.key} className="table-td text-center">
                          {on ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: p.color }}>
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
                              Realizado
                            </span>
                          ) : sched ? (
                            <div>
                              <span className="text-xs text-red-400 font-medium">Sin droneo</span>
                              {nota ? (
                                <p className="text-[11px] text-amber-700 mt-0.5">{nota}</p>
                              ) : isAdmin ? (
                                <button
                                  onClick={() => abrirModal(d, p.key as PlantaKey)}
                                  className="text-[11px] text-gray-300 hover:text-migrin block mx-auto mt-0.5"
                                >
                                  + justificar
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-gray-200 text-xs">—</span>
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
      )}

      {/* ── Modal anotación ── */}
      {modalFecha && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setModalFecha(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 mb-1">Justificación de vuelo</h3>
            <p className="text-sm text-gray-500 mb-4">{modalFecha}</p>

            {/* Selector de planta */}
            <div className="mb-3">
              <label className="label mb-1">Planta</label>
              <div className="flex gap-2">
                {PLANTAS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setModalPlanta(p.key as PlantaKey);
                      setModalMotivo(anots.get(anotKey(modalFecha!, p.key)) ?? "");
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors ${
                      modalPlanta === p.key
                        ? "text-white border-transparent"
                        : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                    style={modalPlanta === p.key ? { background: p.color, borderColor: p.color } : {}}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="label mb-1">Motivo</label>
            <textarea
              className="input w-full"
              rows={3}
              placeholder="Ej: Lluvia, Mantención equipo, Sin personal..."
              value={modalMotivo}
              onChange={(e) => setModalMotivo(e.target.value)}
              autoFocus
            />

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setModalFecha(null)}>Cancelar</button>
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
