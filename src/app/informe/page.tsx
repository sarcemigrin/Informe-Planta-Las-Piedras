"use client";


import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useViewerMode } from "@/hooks/useViewerMode";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena, RegistroTurco, RegistroPeral } from "@/types/database";
import { format, getISOWeek, getISOWeekYear, startOfISOWeek, addDays, eachDayOfInterval, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import {
  ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
  Cell,
} from "recharts";
import { EditArenaModal } from "@/components/EditArenaModal";

//  Paleta corporativa 
const C_DRONE   = "#6BCF7F";
const C_PESO    = "#374151";
const C_INV     = "#94a3b8";
const C_SELECTED = "#6BCF7F22";  // fondo fila seleccionada

//  Umbrales 
const PROD_TARGET = 32;
const INV_TARGET  = 7500;
const INV_WARN    = 6500;
const CUB_INIT    = 15;
const CUB_STEP    = 10;

//  Tipos 
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

//  Helpers 
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

// Tarjeta individual del panel de selección
function InfoCard({
  label, value, sub, color, badge, info,
}: {
  label: string;
  value?: string;
  sub?: string;
  color?: string;
  badge?: { bg: string; text: string; label: string };
  info?: string;
}) {
  return (
    <div className="card relative py-4 px-4 flex flex-col items-center justify-center gap-1 min-w-0 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate w-full text-center">{label}</p>
      {badge ? (
        <span className={`mt-0.5 px-2.5 py-1 rounded-full text-base font-bold ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
      ) : (
        <p className={`text-xl font-bold leading-tight ${color ?? "text-gray-800"}`}>{value ?? "–"}</p>
      )}
      {sub && <p className="text-xs text-gray-400">{sub}</p>}

      {/* Ícono info con tooltip */}
      {info && (
        <div className="absolute bottom-2 right-2 group">
          <svg
            className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors cursor-help"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" strokeWidth={3}/>
            <line x1="12" y1="12" x2="12" y2="16" strokeLinecap="round" strokeWidth={2}/>
          </svg>
          <div className="absolute bottom-5 right-0 w-52 bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5
                          opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20
                          text-left leading-relaxed shadow-lg">
            {info}
          </div>
        </div>
      )}
    </div>
  );
}

//  Página 
export default function InformePage() {
  const { data: session } = useSession();
  const { viewerMode }    = useViewerMode();
  const isAdmin           = session?.user?.rol === "admin" && !viewerMode;

  const [zona, setZona]               = useState<"sur" | "centro">("sur");
  const [centroTurco, setCentroTurco] = useState<RegistroTurco[]>([]);
  const [centroPeral, setCentroPeral] = useState<RegistroPeral[]>([]);
  const [centroLoading, setCentroLoading] = useState(false);
  const [centroLoaded,  setCentroLoaded]  = useState(false);

  const [rows, setRows]               = useState<RegistroArena[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editRow, setEditRow]         = useState<RegistroArena | null>(null);
  const [historial, setHistorial]     = useState<HistorialCambio[]>([]);
  const [showHistorial, setShowHistorial] = useState(false);

  const [generandoPdf, setGenerandoPdf]     = useState(false);
  const [enviandoEmail, setEnviandoEmail]   = useState(false);
  const [emailStatus, setEmailStatus]       = useState<"idle"|"ok"|"error">("idle");
  const cubRef = useRef<HTMLElement>(null);
  const semRef = useRef<HTMLElement>(null);

  // Cubicación
  const [cubLimit, setCubLimit]       = useState(CUB_INIT);
  const [selectedCubId, setSelectedCubId] = useState<string | null>(null);

  // Semanal
  const [semAnios,    setSemAnios]    = useState<number[]>([]);
  const [semSemestre, setSemSemestre] = useState<"todo" | "S1" | "S2">("todo");
  const [semLimit,    setSemLimit]    = useState(10);
  const [selectedSemKey, setSelectedSemKey] = useState<string | null>(null);


  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (zona !== "centro" || centroLoaded || centroLoading) return;
    setCentroLoading(true);
    fetch("/api/centro-data?limit=50")
      .then(r => r.json())
      .then(d => {
        const dedup = <T extends { fecha_hora: string }>(rows: T[]) => {
          const seen = new Set<string>();
          return rows.filter(r => { if (seen.has(r.fecha_hora)) return false; seen.add(r.fecha_hora); return true; });
        };
        setCentroTurco(dedup(d.turco ?? []));
        setCentroPeral(dedup(d.peral ?? []));
        setCentroLoaded(true);
      })
      .finally(() => setCentroLoading(false));
  }, [zona, centroLoaded, centroLoading]);

  async function generarPDF() {
    if (!cubRef.current || !semRef.current) return;
    setGenerandoPdf(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF }   = await import("jspdf");

      // Capturar cada sección
      const opts = { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false };
      const [c1, c2] = await Promise.all([
        html2canvas(cubRef.current, opts),
        html2canvas(semRef.current, opts),
      ]);

      // A4 landscape: 297 × 210 mm
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pw  = pdf.internal.pageSize.getWidth();
      const ph  = pdf.internal.pageSize.getHeight();

      const addImg = (canvas: HTMLCanvasElement, first: boolean) => {
        if (!first) pdf.addPage();
        const ratio   = canvas.width / canvas.height;
        const imgW    = pw;
        const imgH    = imgW / ratio;
        const y       = imgH < ph ? (ph - imgH) / 2 : 0;
        const drawH   = Math.min(imgH, ph);
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, y, imgW, drawH);
      };

      addImg(c1, true);
      addImg(c2, false);

      const fechaStr = new Date().toISOString().slice(0, 10);
      pdf.save(`Informe_Arena_${fechaStr}.pdf`);
    } catch (e) {
      console.error("Error generando PDF:", e);
      alert("Error al generar el PDF. Intenta de nuevo.");
    } finally {
      setGenerandoPdf(false);
    }
  }

  async function enviarPorEmail() {
    if (!cubRef.current || !semRef.current) return;
    setEnviandoEmail(true);
    setEmailStatus("idle");
    try {
      const html2canvas = (await import("html2canvas")).default;
      const opts = { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false };
      const [c1, c2] = await Promise.all([
        html2canvas(cubRef.current, opts),
        html2canvas(semRef.current, opts),
      ]);
      const images = [c1.toDataURL("image/png"), c2.toDataURL("image/png")];

      // Etiqueta para el subject: fecha/hora del último registro
      const last  = rows[rows.length - 1];
      const label = last
        ? `${format(parseISO(last.fecha), "dd/MM/yyyy")} ${last.hora}`
        : new Date().toISOString().slice(0, 10);

      const res = await fetch("/api/informe/email-pdf", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ images, label }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Error desconocido");
      }
      setEmailStatus("ok");
      setTimeout(() => setEmailStatus("idle"), 4000);
    } catch (e) {
      console.error("Error enviando email:", e);
      setEmailStatus("error");
      setTimeout(() => setEmailStatus("idle"), 5000);
    } finally {
      setEnviandoEmail(false);
    }
  }

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

  //  Último registro 
  const ultimoRow = rows.length > 0 ? rows[rows.length - 1] : null;

  //  Cubicación: datos dinámicos según cubLimit 
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

  //  Semanal — mismo criterio que Control Vuelos:
  //  días desde día siguiente al droneo anterior hasta día del droneo actual (inclusive).
  //  Producción dividida en partes iguales por día; cada día aporta a su semana ISO (lun-dom).
  const semanas: Record<string, SemanaStat> = {};
  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = rows[i - 1];

    const fechaPrev = parseISO(prev.fecha);
    const fechaCurr = parseISO(r.fecha);

    // Días del período: desde el día SIGUIENTE al droneo anterior hasta el droneo actual inclusive
    const diasPeriodo = eachDayOfInterval({ start: addDays(fechaPrev, 1), end: fechaCurr });
    const n = Math.max(diasPeriodo.length, 1);

    const prodDrone = r.produccion_drone      ?? 0;
    const prodPeso  = r.produccion_pesometro  ?? 0;
    const despachos = r.despachos_ton         ?? 0;
    const viajes    = r.cantidad_despachos    ?? 0;
    const hrsProd   = r.diferencia_horometro  ?? 0;
    const detencion = r.detencion             ?? 0;

    // Distribuir 1/n de cada valor a la semana ISO de cada día
    for (const dia of diasPeriodo) {
      const wkRef = startOfISOWeek(dia);   // lunes de esa semana (para obtener año ISO correcto)
      const sem   = `${getISOWeekYear(wkRef)}-S${String(getISOWeek(dia)).padStart(2, "0")}`;
      if (!semanas[sem]) semanas[sem] = { semana: sem, prodDrone: 0, prodPeso: 0, despachos: 0, viajes: 0, dias: 0, hrsProd: 0, detencion: 0 };
      semanas[sem].prodDrone  += prodDrone / n;
      semanas[sem].prodPeso   += prodPeso  / n;
      semanas[sem].despachos  += despachos / n;
      semanas[sem].viajes     += viajes    / n;
      semanas[sem].hrsProd    += hrsProd   / n;
      semanas[sem].detencion  += detencion / n;
      semanas[sem].dias       += 1;
    }
  }
  const semanalRows      = Object.values(semanas).sort((a, b) => a.semana.localeCompare(b.semana));
  const anioActual       = new Date().getFullYear();
  const aniosDisponibles = Array.from(new Set(semanalRows.map(s => parseInt(s.semana.split("-")[0])))).sort();

  const S1 = Array.from({ length: 26 }, (_, i) => String(i +  1).padStart(2, "0"));
  const S2 = Array.from({ length: 26 }, (_, i) => String(i + 27).padStart(2, "0"));

  const semanalFiltradas = semanalRows.filter(s => {
    const [aStr, wStr] = s.semana.split("-S");
    if (!semAnios.includes(parseInt(aStr))) return false;
    if (semSemestre === "S1" && !S1.includes(wStr)) return false;
    if (semSemestre === "S2" && !S2.includes(wStr)) return false;
    return true;
  });

  const soloUnAnio      = semAnios.length === 1;
  const semLast10       = semanalFiltradas.slice(-10);
  const chartSemanal = semLast10.map(s => ({
    _key:      s.semana,
    semana:    soloUnAnio ? s.semana.replace(`${semAnios[0]}-`, "") : s.semana,
    prodDrone: +s.prodDrone.toFixed(1),
    prodPeso:  +s.prodPeso.toFixed(1),
    kpiDrone:  s.hrsProd > 0 ? +(s.prodDrone / s.hrsProd).toFixed(1) : null,
    kpiPeso:   s.hrsProd > 0 ? +(s.prodPeso  / s.hrsProd).toFixed(1) : null,
  }));

  // Semana seleccionada (por defecto la última del filtro)
  const lastSemFiltrada   = semanalFiltradas[semanalFiltradas.length - 1] ?? null;
  const selectedSem       = (selectedSemKey ? semanalFiltradas.find(s => s.semana === selectedSemKey) : null) ?? lastSemFiltrada;
  const selectedSemKpiD   = selectedSem && selectedSem.hrsProd > 0 ? selectedSem.prodDrone / selectedSem.hrsProd : 0;
  const selectedSemKpiP   = selectedSem && selectedSem.hrsProd > 0 ? selectedSem.prodPeso  / selectedSem.hrsProd : 0;
  const selectedSemDetPct = selectedSem && (selectedSem.hrsProd + selectedSem.detencion) > 0
    ? selectedSem.detencion / (selectedSem.hrsProd + selectedSem.detencion) * 100 : 0;

  //  Excel 
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

      {/*  Header  */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informe Producción Arena</h1>
          <p className="text-sm text-gray-500">
            {rows.length > 0
              ? <>Del {format(parseISO(rows[0].fecha), "dd/MM/yyyy")} al {format(parseISO(rows[rows.length-1].fecha), "dd/MM/yyyy")} · {rows.length} cubicaciones</>
              : "Sin datos"}
          </p>
        </div>
        {isAdmin && (
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={exportExcel}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar Excel
          </button>
          <button
            className="btn-secondary"
            onClick={generarPDF}
            disabled={generandoPdf}
            style={{ opacity: generandoPdf ? 0.6 : 1 }}
          >
            {generandoPdf ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} strokeDasharray="32" strokeDashoffset="12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            )}
            {generandoPdf ? "Generando…" : "Exportar PDF"}
          </button>

          {/* Botón enviar por email — desactivado temporalmente */}
        </div>
        )}
      </div>

      {/* ── Pestañas Zona Sur / Centro ── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setZona("sur")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            zona === "sur"
              ? "text-white shadow-sm"
              : "text-gray-500 hover:bg-white/60"
          }`}
          style={zona === "sur" ? { backgroundColor: C_DRONE } : {}}
        >
          Zona Sur
        </button>
        <button
          onClick={() => setZona("centro")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            zona === "centro"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-500 hover:bg-white/60"
          }`}
        >
          Zona Centro
        </button>
      </div>

      {/* ══════════════ ZONA SUR ══════════════ */}
      {zona === "sur" && (<>

      {/*
          SECCIÓN 1 — POR CUBICACIÓN
       */}
      <section ref={cubRef}>
        <SectionHeader title="Por Cubicación" sub={`últimos ${cubRows.length} registros`} />

        {/* Panel 8 tarjetas — 4+4 grid */}
        {selectedCubRow && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <InfoCard
                label="Último droneo"
                value={format(parseISO(selectedCubRow.fecha), "dd MMM yyyy", { locale: es })}
                sub={selectedCubRow.hora ? selectedCubRow.hora.slice(0, 5) : undefined}
                info="Fecha y hora del último registro de cubicación por drone."
              />
              <InfoCard
                label="Producción Drone"
                value={fmt(selectedCubRow.produccion_drone)}
                sub="toneladas"
                color={prodColor(selectedCubRow.productividad_drone)}
                info="Producción calculada por diferencia de inventario entre droneos consecutivos más despachos del período."
              />
              <InfoCard
                label="Productividad Drone"
                value={`${fmt(selectedCubRow.productividad_drone)} t/h`}
                color={prodColor(selectedCubRow.productividad_drone)}
                info="Toneladas producidas por hora de horómetro. Meta: ≥32 t/h · Alerta: 28,8–32 t/h · Crítico: <28,8 t/h."
              />
              <InfoCard
                label="Producción Pesóm."
                value={fmt(selectedCubRow.produccion_pesometro)}
                sub="toneladas"
                info="Producción según diferencia de lecturas del pesómetro, ajustada por factor de humedad 0,85. Referencia complementaria al cálculo por drone."
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <InfoCard
                label="Productividad Pesóm."
                value={`${fmt(selectedCubRow.productividad_pesometro)} t/h`}
                info="Productividad calculada en base a la producción del pesómetro dividida por las horas productivas del período."
              />
              <InfoCard
                label="Despachos (ton)"
                value={fmt(selectedCubRow.despachos_ton)}
                sub={`${selectedCubRow.cantidad_despachos ?? 0} viajes`}
                info="Total toneladas despachadas entre el droneo anterior y este, según datos SAP."
              />
              <InfoCard
                label="Inventario"
                value={fmt(selectedCubRow.inventario_ton)}
                sub="toneladas"
                color={invColor(selectedCubRow.inventario_ton)}
                info="Inventario total en canchas al momento del droneo. Meta: ≥7.500 ton · Alerta: 6.500–7.500 ton · Crítico: <6.500 ton."
              />
              <InfoCard
                label="Diferencia"
                badge={difBadge(selectedCubRow.diferencia)}
                sub="vs. período anterior"
                info="Diferencia porcentual entre producción Drone y producción Pesómetro. Valores positivos indican que el pesómetro supera al drone."
              />
            </div>
            <p className="text-xs text-gray-400 -mt-2 mb-3">
              Pincha un punto del gráfico o una fila de la tabla para actualizar
            </p>
          </>
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
                  yAxisId="kpi"
                  y={PROD_TARGET}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  label={{ value: `Control · ${PROD_TARGET} t/h`, position: "insideTopLeft", fill: "#ef4444", fontSize: 10 }}
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
                    <th className="table-th">Inventario</th>
                    <th className="table-th">Viajes</th>
                    <th className="table-th">Despachos (ton)</th>
                    <th className="table-th">Productividad Pesóm.</th>
                    <th className="table-th">Producción Pesóm.</th>
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
                        <td className="table-td-left font-medium text-gray-800">
                          {r.fecha_hora ? format(new Date(r.fecha_hora), "dd/MM/yyyy HH:mm", { locale: es }) : r.fecha}
                          {isSelected && <span className="ml-2 text-[10px] font-bold text-green-600 uppercase"> selec.</span>}
                        </td>
                        <td className={`table-td font-semibold ${prodColor(r.productividad_drone)}`}>
                          {fmt(r.productividad_drone)} <span className="font-normal text-xs">t/h</span>
                        </td>
                        <td className="table-td font-semibold text-gray-800">{fmt(r.produccion_drone)}</td>
                        <td className="table-td text-gray-800">{fmt(r.diferencia_horometro, 1)}</td>
                        <td className={`table-td font-medium ${(r.detencion ?? 0) > 0 ? "text-red-500" : "text-gray-800"}`}>{fmt(r.detencion, 1)}</td>
                        <td className={`table-td font-semibold ${invColor(r.inventario_ton)}`}>{fmt(r.inventario_ton)}</td>
                        <td className="table-td text-gray-800">{r.cantidad_despachos ?? "–"}</td>
                        <td className="table-td text-gray-800">{fmt(r.despachos_ton)}</td>
                        <td className="table-td text-gray-800">
                          {fmt(r.productividad_pesometro)} <span className="text-xs">t/h</span>
                        </td>
                        <td className="table-td text-gray-800">{fmt(r.produccion_pesometro)}</td>
                        <td className="table-td">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span>
                        </td>
                        {isAdmin && (
                          <td className="table-td">
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditRow(r); }}
                              className="text-gray-300 hover:text-migrin transition-colors text-base leading-none"
                              title="Editar"
                            ></button>
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

      {/* 
          SECCIÓN 2 — SEMANAL
       */}
      <section ref={semRef}>
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

        {/* Panel 8 tarjetas semana seleccionada */}
        {selectedSem && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {/* Tarjeta semana: número grande + año pequeño */}
              {(() => {
                const [anioStr, semStr] = selectedSem.semana.split("-");
                return (
                  <div className="card relative py-4 px-4 flex flex-col items-center justify-center gap-1 text-center overflow-hidden">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Semana</p>
                    <p className="text-xl font-bold text-gray-900">{semStr}</p>
                    <p className="text-xs text-gray-400">{anioStr}</p>
                    <div className="absolute bottom-2 right-2 group">
                      <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" strokeWidth={3}/><line x1="12" y1="12" x2="12" y2="16" strokeLinecap="round" strokeWidth={2}/>
                      </svg>
                      <div className="absolute bottom-5 right-0 w-52 bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20 text-left leading-relaxed shadow-lg">
                        Número de semana ISO del año seleccionado.
                      </div>
                    </div>
                  </div>
                );
              })()}
              <InfoCard
                label="Horas Productivas"
                value={`${fmt(selectedSem.hrsProd, 1)} hrs`}
                info="Total de horas productivas acumuladas en la semana según diferencia de horómetro entre registros."
              />
              <InfoCard
                label="Detención"
                value={`${fmt(selectedSem.detencion, 1)} hrs`}
                sub={`${selectedSemDetPct.toFixed(1)}% del tiempo`}
                color="text-red-500"
                info="Horas de detención no productivas. El porcentaje indica la proporción respecto al tiempo total disponible."
              />
              <InfoCard
                label="Despachos"
                value={fmt(selectedSem.despachos)}
                sub={`${selectedSem.viajes} viajes`}
                info="Total toneladas despachadas en la semana según datos SAP, con el número de viajes asociados."
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <InfoCard
                label="Productividad Drone"
                value={`${fmt(selectedSemKpiD)} t/h`}
                color={prodColor(selectedSemKpiD)}
                info="Promedio de productividad semanal calculado como producción drone total dividida por horas productivas. Meta: ≥32 t/h."
              />
              <InfoCard
                label="Producción Drone"
                value={fmt(selectedSem.prodDrone)}
                sub="toneladas"
                info="Total toneladas producidas en la semana según cálculo por drone (diferencia de inventario más despachos)."
              />
              <InfoCard
                label="Productividad Pesóm."
                value={`${fmt(selectedSemKpiP)} t/h`}
                info="Productividad semanal calculada en base a la producción del pesómetro dividida por horas productivas."
              />
              <InfoCard
                label="Producción Pesóm."
                value={fmt(selectedSem.prodPeso)}
                sub="toneladas"
                info="Total toneladas producidas en la semana según pesómetro, ajustadas por factor de humedad 0,85."
              />
            </div>
            <p className="text-xs text-gray-400 -mt-2 mb-3">
              Pincha una barra del gráfico o una fila de la tabla para actualizar
            </p>
          </>
        )}

        {/* Gráfico semanal — barras producción (eje izq.) + líneas productividad (eje der.) */}
        {chartSemanal.length > 0 && (
          <div className="card mb-4 cursor-pointer">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={chartSemanal}
                margin={{ top: 5, right: 50, left: 10, bottom: 45 }}
                onClick={(data) => {
                  if (!data?.activePayload?.[0]) return;
                  const key = (data.activePayload[0].payload as { _key: string })._key;
                  setSelectedSemKey(key);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 9 }} interval={0} angle={-45} textAnchor="end" height={55} />
                <YAxis
                  yAxisId="ton"
                  tick={{ fontSize: 10 }}
                  label={{ value: "ton", angle: -90, position: "insideLeft", offset: -2, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <YAxis
                  yAxisId="kpi"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  label={{ value: "t/h", angle: 90, position: "insideRight", offset: 12, style: { fontSize: 9, fill: "#9ca3af" } }}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const isKpi = String(name).startsWith("Productividad");
                    return [`${fmt(value as number)} ${isKpi ? "t/h" : "ton"}`, name];
                  }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Legend
                  content={() => (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 20px", justifyContent: "center", fontSize: 12, marginTop: 4 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, backgroundColor: "rgba(107,207,127,0.6)" }} />
                        Producción Drone
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, backgroundColor: "rgba(55,65,81,0.5)" }} />
                        Producción Pesóm.
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ display: "inline-block", width: 20, height: 2.5, borderRadius: 2, backgroundColor: C_DRONE, verticalAlign: "middle" }} />
                        Productividad Drone
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ display: "inline-block", width: 20, height: 2.5, borderRadius: 2, backgroundColor: C_PESO, verticalAlign: "middle" }} />
                        Productividad Pesóm.
                      </span>
                    </div>
                  )}
                />
                <Bar yAxisId="ton" dataKey="prodDrone" name="Producción Drone" radius={[3, 3, 0, 0]}>
                  {chartSemanal.map((entry) => (
                    <Cell key={entry._key} fill={entry._key === selectedSem?.semana ? C_DRONE : "rgba(107,207,127,0.45)"} />
                  ))}
                </Bar>
                <Bar yAxisId="ton" dataKey="prodPeso" name="Producción Pesóm." radius={[3, 3, 0, 0]}>
                  {chartSemanal.map((entry) => (
                    <Cell key={entry._key} fill={entry._key === selectedSem?.semana ? C_PESO : "rgba(55,65,81,0.4)"} />
                  ))}
                </Bar>
                <Line yAxisId="kpi" type="monotone" dataKey="kpiDrone" name="Productividad Drone"  stroke={C_DRONE} strokeWidth={2.5} dot={{ r: 3, fill: C_DRONE, strokeWidth: 0 }} connectNulls activeDot={{ r: 5 }} />
                <Line yAxisId="kpi" type="monotone" dataKey="kpiPeso"  name="Productividad Pesóm." stroke={C_PESO}  strokeWidth={2.5} dot={{ r: 3, fill: C_PESO,  strokeWidth: 0 }} connectNulls activeDot={{ r: 5 }} />
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
                  <th className="table-th">Productividad Drone</th>
                  <th className="table-th">Prod. Drone</th>
                  <th className="table-th">Hrs Prod.</th>
                  <th className="table-th">Detención (hrs)</th>
                  <th className="table-th">Det. Planta %</th>
                  <th className="table-th">Productividad Pesóm.</th>
                  <th className="table-th">Prod. Pesóm.</th>
                  <th className="table-th">Despachos (vj)</th>
                  <th className="table-th">Despachos (ton)</th>
                  <th className="table-th">Prod / día</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const reversed = [...semanalFiltradas].reverse();
                  return reversed.slice(0, semLimit).map((s, idx) => {
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
                          {isSel && <span className="ml-2 text-[10px] font-bold text-green-600 uppercase"> selec.</span>}
                        </td>
                        <td className={`table-td font-semibold ${prodColor(kpiD)}`}>
                          {fmt(kpiD)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className="table-td font-semibold text-gray-700">{fmt(s.prodDrone)}</td>
                        <td className="table-td text-gray-600">{fmt(s.hrsProd, 1)}</td>
                        <td className={`table-td ${s.detencion > 0 ? "text-red-400" : "text-gray-400"}`}>{fmt(s.detencion, 1)}</td>
                        <td className="table-td text-gray-500">{detPct.toFixed(1)}%</td>
                        <td className="table-td font-semibold text-gray-600">
                          {fmt(kpiP)} <span className="text-gray-400 font-normal text-xs">t/h</span>
                        </td>
                        <td className="table-td text-gray-600">{fmt(s.prodPeso)}</td>
                        <td className="table-td text-gray-600">{fmt(s.viajes)}</td>
                        <td className="table-td text-gray-600">{fmt(s.despachos)}</td>
                        <td className="table-td text-gray-500">{fmt(s.prodDrone / Math.max(s.dias, 1))}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
            {/* Footer paginación semanal */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
              <span className="text-xs text-gray-400">
                Mostrando {Math.min(semLimit, semanalFiltradas.length)} de {semanalFiltradas.length} semanas
              </span>
              <div className="flex gap-2">
                {semLimit > 10 && (
                  <button className="btn-secondary text-xs py-1 px-3" onClick={() => setSemLimit(l => Math.max(10, l - 10))}>
                    Ver 10 menos
                  </button>
                )}
                {semLimit < semanalFiltradas.length && (
                  <button className="btn-secondary text-xs py-1 px-3" onClick={() => setSemLimit(l => l + 10)}>
                    Ver 10 más
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 
          SECCIÓN 3 — HISTORIAL (solo admin)
       */}
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

      {/* ── Destinatarios del Informe — movido a página Arena ── */}

      </>)} {/* fin Zona Sur */}

      {/* ══════════════ ZONA CENTRO ══════════════ */}
      {zona === "centro" && (
        <CentroInformeView
          turcoRows={centroTurco}
          peralRows={centroPeral}
          loading={centroLoading}
        />
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

/* ─────────────────────────────────────────────
   Zona Centro — Vista consolidada en Informe
───────────────────────────────────────────────*/
function CentroInformeView({
  turcoRows, peralRows, loading,
}: {
  turcoRows: RegistroTurco[];
  peralRows: RegistroPeral[];
  loading: boolean;
}) {
  const [centroVerTodo, setCentroVerTodo] = useState(false);

  if (loading) return <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Cargando datos Zona Centro…</div>;

  const tLast = turcoRows[0] ?? null;
  const pLast = peralRows[0] ?? null;

  // Historial para gráficos (orden cronológico, últimos 12 o todos)
  const tChart = [...turcoRows].reverse().slice(centroVerTodo ? 0 : -12).map(r => ({
    mes: r.fecha.slice(0, 10),
    tlh:      r.tlh_ton      ?? null,
    arena:    r.arena_mina_ton ?? null,
    fierrillo:r.fierrillo_total_ton ?? null,
    grancilla:r.grancilla_ton ?? null,
  }));
  const pChart = [...peralRows].reverse().slice(centroVerTodo ? 0 : -12).map(r => ({
    mes:      r.fecha.slice(0, 10),
    stock:    r.stock_arena_humeda_ton ?? null,
    arena:    r.arena_mina_ton ?? null,
    a22:      r.a22_ton ?? null,
    a25:      r.a25_ton ?? null,
    grancilla:r.grancilla_ton ?? null,
  }));

  return (
    <div className="space-y-8">
      {/* ══ TURCO ══ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded-full bg-amber-500 shrink-0" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-700">Planta El Turco</h2>
        </div>

        {/* KPIs */}
        {tLast ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card flex flex-col gap-1 border-amber-300 bg-amber-50 ring-1 ring-amber-200">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">TLH ★</p>
              <p className="text-2xl font-bold text-amber-800">{fmt(tLast.tlh_ton)}</p>
              <p className="text-xs text-amber-600">ton</p>
            </div>
            <div className="card flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Arena Mina</p>
              <p className="text-xl font-bold text-gray-800">{fmt(tLast.arena_mina_ton)}</p>
              <p className="text-xs text-gray-400">ton</p>
            </div>
            <div className="card flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Fierrillo Total</p>
              <p className="text-xl font-bold text-green-700">{fmt(tLast.fierrillo_total_ton)}</p>
              <p className="text-xs text-gray-400">ton</p>
            </div>
            <div className="card flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Grancilla</p>
              <p className="text-xl font-bold text-gray-800">{fmt(tLast.grancilla_ton)}</p>
              <p className="text-xs text-gray-400">ton</p>
            </div>
          </div>
        ) : <p className="text-sm text-gray-400">Sin registros Turco</p>}

        {/* Gráfico */}
        {tChart.length > 1 && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700 text-sm">TLH & Arena Mina — histórico</h3>
              <button onClick={() => setCentroVerTodo(v => !v)} className="text-xs text-blue-600 hover:underline">
                {centroVerTodo ? "Últimos 12" : "Ver todo"}
              </button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={tChart} margin={{ top:5, right:10, left:0, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: unknown) => fmt(v as number, 1) + " ton"} />
                <Legend />
                <Line type="monotone" dataKey="tlh"       name="TLH"          stroke="#f59e0b" strokeWidth={3} dot={{ r:3 }} connectNulls />
                <Line type="monotone" dataKey="arena"     name="Arena Mina"   stroke="#3b82f6" strokeWidth={2} dot={{ r:3 }} connectNulls />
                <Line type="monotone" dataKey="fierrillo" name="Fierrillo Ttl" stroke="#16a34a" strokeWidth={2} dot={{ r:2 }} connectNulls strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabla */}
        {turcoRows.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="font-semibold text-gray-700 text-sm">Últimos registros Turco</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-th text-left">Fecha</th>
                    <th className="table-th">TLH ton</th>
                    <th className="table-th">Arena Mina ton</th>
                    <th className="table-th">Estéril ton</th>
                    <th className="table-th">Grancilla ton</th>
                    <th className="table-th">Fierr. A ton</th>
                    <th className="table-th">Fierr. B ton</th>
                    <th className="table-th">Fierr. Total ton</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {turcoRows.slice(0, 10).map((r, i) => (
                    <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                      <td className="table-td-left font-medium">{r.fecha}</td>
                      <td className="table-td font-semibold text-amber-700">{fmt(r.tlh_ton)}</td>
                      <td className="table-td font-semibold text-blue-700">{fmt(r.arena_mina_ton)}</td>
                      <td className="table-td">{fmt(r.esteril_ton)}</td>
                      <td className="table-td">{fmt(r.grancilla_ton)}</td>
                      <td className="table-td">{fmt(r.fierrillo_a_ton)}</td>
                      <td className="table-td">{fmt(r.fierrillo_b_ton)}</td>
                      <td className="table-td font-semibold text-green-700">{fmt(r.fierrillo_total_ton)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* divider */}
      <div className="border-t border-gray-200" />

      {/* ══ PERAL ══ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded-full bg-cyan-500 shrink-0" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-700">Planta Peral</h2>
        </div>

        {/* KPIs */}
        {pLast ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card flex flex-col gap-1 border-cyan-300 bg-cyan-50 ring-1 ring-cyan-200">
              <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-600">Stock Húmeda ★</p>
              <p className="text-2xl font-bold text-cyan-800">{fmt(pLast.stock_arena_humeda_ton)}</p>
              <p className="text-xs text-cyan-600">ton</p>
            </div>
            <div className="card flex flex-col gap-1 border-blue-200 bg-blue-50 ring-1 ring-blue-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Arena Mina ★</p>
              <p className="text-2xl font-bold text-blue-800">{fmt(pLast.arena_mina_ton)}</p>
              <p className="text-xs text-blue-600">ton</p>
            </div>
            <div className="card flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">A-22</p>
              <p className="text-xl font-bold text-gray-800">{fmt(pLast.a22_ton)}</p>
              <p className="text-xs text-gray-400">ton</p>
            </div>
            <div className="card flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Grancilla</p>
              <p className="text-xl font-bold text-gray-800">{fmt(pLast.grancilla_ton)}</p>
              <p className="text-xs text-gray-400">ton</p>
            </div>
          </div>
        ) : <p className="text-sm text-gray-400">Sin registros Peral</p>}

        {/* Gráfico */}
        {pChart.length > 1 && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700 text-sm">Stock Húmeda & Arena Mina — histórico</h3>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={pChart} margin={{ top:5, right:10, left:0, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: unknown) => fmt(v as number, 1) + " ton"} />
                <Legend />
                <Line type="monotone" dataKey="stock"    name="Stock Húmeda" stroke="#6BCF7F" strokeWidth={3} dot={{ r:4 }} connectNulls />
                <Line type="monotone" dataKey="arena"    name="Arena Mina"   stroke="#3b82f6" strokeWidth={2} dot={{ r:3 }} connectNulls />
                <Line type="monotone" dataKey="a22"      name="A-22"         stroke="#f59e0b" strokeWidth={1.5} dot={{ r:2 }} connectNulls strokeDasharray="4 2" />
                <Line type="monotone" dataKey="a25"      name="A-25"         stroke="#a78bfa" strokeWidth={1.5} dot={{ r:2 }} connectNulls strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabla */}
        {peralRows.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="font-semibold text-gray-700 text-sm">Últimos registros Peral</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-th text-left">Fecha</th>
                    <th className="table-th">Stock Húmeda</th>
                    <th className="table-th">Arena Mina</th>
                    <th className="table-th">A-22</th>
                    <th className="table-th">A-24</th>
                    <th className="table-th">A-25</th>
                    <th className="table-th">A-26</th>
                    <th className="table-th">DMH</th>
                    <th className="table-th">Grancilla</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {peralRows.slice(0, 10).map((r, i) => (
                    <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                      <td className="table-td-left font-medium">{r.fecha}</td>
                      <td className="table-td font-semibold text-cyan-700">{fmt(r.stock_arena_humeda_ton)}</td>
                      <td className="table-td font-semibold text-blue-700">{fmt(r.arena_mina_ton)}</td>
                      <td className="table-td">{fmt(r.a22_ton)}</td>
                      <td className="table-td">{fmt(r.a24_ton)}</td>
                      <td className="table-td">{fmt(r.a25_ton)}</td>
                      <td className="table-td">{fmt(r.a26_ton)}</td>
                      <td className="table-td">{fmt(r.dmh_ton)}</td>
                      <td className="table-td">{fmt(r.grancilla_ton)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Panel de gestión de destinatarios — 3 pestañas
───────────────────────────────────────────────*/
interface Destinatario { email: string; nombre: string; activo: boolean; }
type PlantaTab = "sur" | "turco" | "peral";

const TAB_LABEL: Record<PlantaTab, string> = { sur: "Zona Sur", turco: "Turco", peral: "Peral" };
const TAB_COLOR: Record<PlantaTab, { active: string; badge: string }> = {
  sur:   { active: "border-green-500 text-green-700",  badge: "bg-green-100 text-green-700"  },
  turco: { active: "border-amber-500 text-amber-700",  badge: "bg-amber-100 text-amber-700"  },
  peral: { active: "border-cyan-500  text-cyan-700",   badge: "bg-cyan-100  text-cyan-700"   },
};

function DestinatariosPanel() {
  const [tab,       setTab]       = useState<PlantaTab>("sur");
  const [lists,     setLists]     = useState<Record<PlantaTab, Destinatario[]>>({ sur: [], turco: [], peral: [] });
  const [loaded,    setLoaded]    = useState<Record<PlantaTab, boolean>>({ sur: false, turco: false, peral: false });
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState<{ok:boolean;text:string}|null>(null);
  const [newEmail,  setNewEmail]  = useState("");
  const [newNombre, setNewNombre] = useState("");
  const [open,      setOpen]      = useState(false);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  }

  useEffect(() => {
    if (loaded[tab]) return;
    fetch(`/api/informe/recipients?planta=${tab}`)
      .then(r => r.json())
      .then(d => {
        setLists(prev => ({ ...prev, [tab]: d.recipients ?? [] }));
        setLoaded(prev => ({ ...prev, [tab]: true }));
      })
      .catch(() => setLoaded(prev => ({ ...prev, [tab]: true })));
  }, [tab, loaded]);

  const list = lists[tab];
  const isLoading = !loaded[tab];

  async function persist(updated: Destinatario[]) {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/informe/recipients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planta: tab, recipients: updated }),
      });
      const d = await r.json();
      if (d.ok) { setLists(prev => ({ ...prev, [tab]: updated })); flash(true, "Guardado"); }
      else       flash(false, d.error ?? "Error al guardar");
    } catch { flash(false, "Error de conexión"); }
    setSaving(false);
  }

  function toggle(idx: number) {
    const updated = list.map((d,i) => i === idx ? { ...d, activo: !d.activo } : d);
    setLists(prev => ({ ...prev, [tab]: updated }));
    persist(updated);
  }

  function setAll(activo: boolean) {
    const updated = list.map(d => ({ ...d, activo }));
    setLists(prev => ({ ...prev, [tab]: updated }));
    persist(updated);
  }

  function remove(idx: number) {
    if (!confirm("¿Eliminar este destinatario?")) return;
    persist(list.filter((_,i) => i !== idx));
  }

  function add() {
    const email = newEmail.trim().toLowerCase();
    const nombre = newNombre.trim();
    if (!email || !email.includes("@")) return;
    if (list.some(d => d.email === email)) { flash(false, "El correo ya existe"); return; }
    persist([...list, { email, nombre: nombre || email, activo: true }]);
    setNewEmail(""); setNewNombre(""); setOpen(false);
  }

  const activos = list.filter(d => d.activo).length;
  const todosActivos = list.length > 0 && activos === list.length;
  const colors = TAB_COLOR[tab];

  return (
    <section className="card mt-6">
      {/* Cabecera */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">Destinatarios por Planta</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cada planta notifica solo a sus destinatarios al guardar un registro</p>
        </div>
        <button onClick={() => setOpen(o => !o)} className="btn-secondary text-xs px-3 py-1.5 shrink-0">+ Agregar</button>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        {(["sur","turco","peral"] as PlantaTab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setOpen(false); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? TAB_COLOR[t].active
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {TAB_LABEL[t]}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              tab === t ? TAB_COLOR[t].badge : "bg-gray-100 text-gray-400"
            }`}>
              {lists[t].filter(d => d.activo).length}
            </span>
          </button>
        ))}
      </div>

      {/* Formulario agregar */}
      {open && (
        <div className="mb-4 p-3 bg-gray-50 rounded-xl flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Nombre</label>
            <input className="input text-sm w-44" placeholder="Juan Pérez"
              value={newNombre} onChange={e => setNewNombre(e.target.value)}/>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Correo</label>
            <input className="input text-sm w-52" placeholder="email@empresa.com" type="email"
              value={newEmail} onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && add()}/>
          </div>
          <button onClick={add} className="btn-primary text-xs px-4 py-2">Agregar a {TAB_LABEL[tab]}</button>
          <button onClick={() => setOpen(false)} className="btn-secondary text-xs px-3 py-2">Cancelar</button>
        </div>
      )}

      {/* Acciones masivas */}
      {!isLoading && list.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-gray-100">
          <button onClick={() => setAll(true)} disabled={todosActivos || saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-40 transition-colors">
            Activar todos
          </button>
          <button onClick={() => setAll(false)} disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 transition-colors">
            Desactivar todos
          </button>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <p className="text-xs text-gray-400 py-4 text-center">Cargando...</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">Sin destinatarios — agrega uno con el botón de arriba</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {list.map((d, i) => (
            <div key={d.email} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <button onClick={() => toggle(i)} disabled={saving}
                  className={"relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:cursor-wait " + (d.activo ? "bg-green-500" : "bg-gray-200")}
                  title={d.activo ? "Desactivar" : "Activar"}>
                  <span className={"inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform duration-200 " + (d.activo ? "translate-x-4" : "translate-x-0.5")}/>
                </button>
                <div>
                  <p className={"text-sm font-medium " + (d.activo ? "text-gray-800" : "text-gray-400")}>{d.nombre}</p>
                  <p className={"text-xs " + (d.activo ? "text-gray-500" : "text-gray-300")}>{d.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (d.activo ? colors.badge : "bg-gray-100 text-gray-400")}>
                  {d.activo ? "Activo" : "Inactivo"}
                </span>
                <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 transition-colors text-xs px-1" title="Eliminar">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Feedback */}
      {(saving || msg) && (
        <div className={"mt-3 text-xs px-3 py-2 rounded-lg " + (saving ? "bg-gray-50 text-gray-400" : msg?.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>
          {saving ? "Guardando..." : msg?.text}
        </div>
      )}
    </section>
  );
}
