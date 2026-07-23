"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useViewerMode } from "@/hooks/useViewerMode";
import {
  format, eachDayOfInterval, getDay, isBefore, isToday,
  addMonths, subMonths, startOfMonth, endOfMonth, startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";

// ── Colores por planta (mismos que el resto de la app) ──────────────────────
// scheduledDow: días de la semana programados (0=dom,1=lun,...,6=sáb)
const PLANTAS = [
  { key: "turco",   label: "El Turco",    color: "#f59e0b", scheduledDow: [1,3,5,6] }, // lun+mié+vie/sáb
  { key: "peral",   label: "El Peral",    color: "#06b6d4", scheduledDow: [3,6]     }, // mié+sáb
  { key: "piedras", label: "Las Piedras", color: "#22c55e", scheduledDow: [1,2,3,4,5] }, // lun-vie
] as const;

type PlantaKey = "turco" | "peral" | "piedras";

interface VuelosData {
  turco:   string[];
  peral:   string[];
  piedras: string[];
}

interface Anotacion {
  fecha:  string;
  motivo: string;
}

export default function DiarioPage() {
  const { data: session } = useSession();
  const { viewerMode } = useViewerMode();
  const isAdmin = session?.user?.rol === "admin" && !viewerMode;

  const [loading, setLoading]     = useState(true);
  const [vuelos, setVuelos]       = useState<VuelosData>({ turco: [], peral: [], piedras: [] });
  const [anotaciones, setAnotaciones] = useState<Map<string, string>>(new Map());
  const [calMes, setCalMes]       = useState(() => startOfMonth(new Date()));

  // Modal anotación
  const [modalFecha, setModalFecha]     = useState<string | null>(null);
  const [modalMotivo, setModalMotivo]   = useState("");
  const [modalGuardando, setModalGuardando] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [vRes, aRes] = await Promise.all([
      fetch("/api/vuelos"),
      fetch(`/api/anotaciones?anio=${new Date().getFullYear()}`),
    ]);
    if (vRes.ok) setVuelos(await vRes.json());
    if (aRes.ok) {
      const data: Anotacion[] = await aRes.json();
      const map = new Map<string, string>();
      data.forEach((a) => map.set(a.fecha, a.motivo));
      setAnotaciones(map);
    }
    setLoading(false);
  }

  async function guardarAnotacion() {
    if (!modalFecha || !modalMotivo.trim()) return;
    setModalGuardando(true);
    try {
      const res = await fetch("/api/anotaciones", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fecha: modalFecha, motivo: modalMotivo.trim() }),
      });
      if (!res.ok) { alert("Error al guardar"); return; }
      setAnotaciones((prev) => new Map(prev).set(modalFecha!, modalMotivo.trim()));
      setModalFecha(null);
      setModalMotivo("");
    } finally {
      setModalGuardando(false);
    }
  }

  // ── Conjuntos para lookup rápido ──────────────────────────────────────────
  const sets: Record<PlantaKey, Set<string>> = {
    turco:   new Set(vuelos.turco),
    peral:   new Set(vuelos.peral),
    piedras: new Set(vuelos.piedras),
  };

  // ── KPIs del mes actual ───────────────────────────────────────────────────
  const mesKey = format(calMes, "yyyy-MM");
  function vuelosMes(key: PlantaKey) {
    return [...sets[key]].filter((f) => f.startsWith(mesKey)).length;
  }
  // Días programados transcurridos en el mes para una planta
  function diasProgramadosMes(scheduledDow: readonly number[]) {
    const start  = startOfMonth(calMes);
    const end    = endOfMonth(calMes);
    const today  = startOfDay(new Date());
    const limite = isBefore(end, today) ? end : today;
    if (isBefore(limite, start)) return 0;
    return eachDayOfInterval({ start, end: limite })
      .filter((d) => scheduledDow.includes(d.getDay())).length;
  }

  // ── Celdas del calendario ────────────────────────────────────────────────
  const calDays: (Date | null)[] = (() => {
    const start   = startOfMonth(calMes);
    const end     = endOfMonth(calMes);
    const startDow = (getDay(start) + 6) % 7; // lunes = 0
    const blanks  = Array<null>(startDow).fill(null);
    const days: (Date | null)[] = [...blanks];
    eachDayOfInterval({ start, end }).forEach((d) => days.push(d));
    return days;
  })();

  const hoy = startOfDay(new Date());

  // finde global solo para el número del día (estilo visual)
  // Domingo siempre es finde. Sábado es finde solo si ninguna planta lo tiene programado.
  const sabadoEsLaboral = PLANTAS.some((p) => (p.scheduledDow as readonly number[]).includes(6));
  function esFinde(d: Date) {
    const dow = d.getDay();
    if (dow === 0) return true;
    if (dow === 6) return !sabadoEsLaboral;
    return false;
  }
  function esFuturo(d: Date) { return isBefore(hoy, startOfDay(d)) && !isToday(d); }
  // ¿Es día programado para esta planta?
  function esScheduled(d: Date, scheduledDow: readonly number[]) {
    return scheduledDow.includes(d.getDay());
  }

  function abrirModal(d: Date) {
    if (!isAdmin) return;
    const key = format(d, "yyyy-MM-dd");
    if (esFinde(d) || esFuturo(d)) return;
    setModalFecha(key);
    setModalMotivo(anotaciones.get(key) ?? "");
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  );

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
          <span className="btn-secondary text-xs px-4 py-1 capitalize">
            {format(calMes, "MMMM yyyy", { locale: es })}
          </span>
          <button className="btn-secondary text-xs px-3 py-1" onClick={() => setCalMes((m) => addMonths(m, 1))}>›</button>
        </div>
      </div>

      {/* ── KPIs por planta ── */}
      <div className="grid grid-cols-3 gap-4">
        {PLANTAS.map((p) => {
          const realizados    = vuelosMes(p.key);
          const programados   = diasProgramadosMes(p.scheduledDow);
          const noRealizados  = Math.max(programados - realizados, 0);
          const pct           = programados > 0 ? Math.round((realizados / programados) * 100) : 0;
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
      <div className="flex items-center gap-6 flex-wrap text-xs text-gray-500">
        {PLANTAS.map((p) => (
          <div key={p.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: p.color }} />
            {p.label}
          </div>
        ))}
        <span className="text-gray-300">·</span>
        <span>Encendido = droneo realizado · Apagado = sin droneo</span>
      </div>

      {/* ── Calendario semáforo ── */}
      <div className="card">
        {/* Cabecera días de semana */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map((d) => (
            <div key={d} className="text-center text-[10px] text-gray-400 font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Celdas */}
        <div className="grid grid-cols-7 gap-1">
          {calDays.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const key    = format(d, "yyyy-MM-dd");
            const futuro = esFuturo(d);
            const finde  = esFinde(d);
            const hoyDia = isToday(d);
            const nota   = anotaciones.get(key);

            return (
              <div
                key={key}
                onClick={() => !futuro && !finde && abrirModal(d)}
                title={nota ? `Anotación: ${nota}` : undefined}
                className={`
                  rounded-lg flex flex-col items-center py-2 gap-1.5 select-none transition-colors
                  ${finde  ? "bg-gray-50" : ""}
                  ${futuro ? "opacity-30" : ""}
                  ${!finde && !futuro && isAdmin ? "cursor-pointer hover:bg-gray-50" : ""}
                  ${hoyDia ? "ring-2 ring-migrin ring-offset-1" : ""}
                `}
              >
                {/* Número del día */}
                <span className={`text-[11px] font-medium ${hoyDia ? "text-migrin" : "text-gray-500"} ${finde ? "text-gray-300" : ""}`}>
                  {format(d, "d")}
                </span>

                {/* Tres luces */}
                {!futuro && (
                  <div className="flex gap-[3px]">
                    {PLANTAS.map((p) => {
                      const on         = sets[p.key].has(key);
                      const scheduled  = esScheduled(d, p.scheduledDow);
                      // encendido si realizó; apagado-visible si era día programado; casi invisible si no era día programado
                      const opacity    = on ? 1 : scheduled ? 0.18 : 0.05;
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

                {/* Punto de anotación */}
                {nota && !futuro && (
                  <span className="w-1 h-1 rounded-full bg-amber-400 mt-0.5" title={nota} />
                )}
              </div>
            );
          })}
        </div>
      </div>

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
            <h3 className="font-semibold text-gray-800 mb-1">Anotación</h3>
            <p className="text-sm text-gray-500 mb-3">
              {modalFecha} — {anotaciones.has(modalFecha) ? "Editar motivo" : "¿Agregar nota para este día?"}
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
