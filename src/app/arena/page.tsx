"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase } from "@/lib/supabase";
import {
  calcularArena, fmt, ARTICULOS_ARENA_PROD,
  type ArenaInput,
} from "@/lib/calculations";
import type { RegistroArena } from "@/types/database";
import { format } from "date-fns";

const CONOS = [1, 2, 3] as const;

const today = () => format(new Date(), "yyyy-MM-dd");
const nowTime = () => format(new Date(), "HH:mm");

// Tonelaje mínimo por viaje para incluir en cálculo
const FORM_KEY = "arena-form-draft";

// Suma minutos a un string de fecha/hora local (sin conversión UTC).
// Los despachos en la DB están guardados en hora local de Chile,
// por lo que NO se debe convertir a UTC al consultar.
function addMinutes(localStr: string, minutes: number): string {
  // Forzar parseo como UTC para que la aritmética no dependa del timezone del browser
  const d = new Date(localStr.endsWith("Z") ? localStr : localStr + "Z");
  d.setTime(d.getTime() + minutes * 60_000);
  return d.toISOString().slice(0, 19); // "2026-06-18T09:34:00" — sin Z
}

function formToInput(f: Record<string, string>): ArenaInput {
  return {
    fecha:     f.fecha,
    hora:      f.hora,
    pesometro: parseFloat(f.pesometro) || 0,
    horometro: parseFloat(f.horometro) || 0,
    fierrillo: parseFloat(f.fierrillo) || 0,
    cono_1: parseFloat(f.cono_1) || 0,
    cono_2: parseFloat(f.cono_2) || 0,
    cono_3: parseFloat(f.cono_3) || 0,
    pila_1: parseFloat(f.pila_1) || 0,
    pila_2: parseFloat(f.pila_2) || 0,
    pila_3: parseFloat(f.pila_3) || 0,
    pila_4: parseFloat(f.pila_4) || 0,
    pila_5: parseFloat(f.pila_5) || 0,
    pila_6: parseFloat(f.pila_6) || 0,
    pila_7: parseFloat(f.pila_7) || 0,
  };
}

function loadDraft(): Record<string, string> {
  const defaults = {
    fecha: today(), hora: nowTime(), pesometro: "", horometro: "", fierrillo: "0",
    cono_1: "", cono_2: "", cono_3: "",
    pila_1: "", pila_2: "", pila_3: "", pila_4: "",
    pila_5: "", pila_6: "", pila_7: "",
    notas: "",
  };
  try {
    const saved = typeof window !== "undefined" ? localStorage.getItem(FORM_KEY) : null;
    if (!saved) return defaults;
    return { ...defaults, ...JSON.parse(saved) };
  } catch { return defaults; }
}

export default function ArenaPage() {
  const [form, setForm] = useState<Record<string, string>>(loadDraft);

  const [historial, setHistorial]           = useState<RegistroArena[]>([]);
  const [prevRow, setPrevRow]               = useState<(RegistroArena) | null>(null);
  const [preview, setPreview]               = useState<ReturnType<typeof calcularArena> | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [syncing, setSyncing]               = useState(false);
  const [msg, setMsg]                       = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [ultimosDespachos, setUltimosDespachos] = useState<{
    id: number; fecha: string; hora: string; patente: string | null;
    articulo: string | null; toneladas: number | null; ton_final: number | null;
  }[]>([]);
  const [previewDespachos, setPreviewDespachos] = useState<{
    ton: number; viajes: number;
    a36ton: number; a36viajes: number;
    a39ton: number; a39viajes: number;
    rows: { fecha: string; hora: string; articulo: string; ton_final: number | null; toneladas: number | null; folio: number | null }[];
  }>({ ton: 0, viajes: 0, a36ton: 0, a36viajes: 0, a39ton: 0, a39viajes: 0, rows: [] });
  const [showDespDebug, setShowDespDebug] = useState(false);
  const [warnings, setWarnings] = useState<{ pesometro?: string; horometro?: string }>({});

  // ---- Persistir borrador en localStorage ----
  useEffect(() => {
    try { localStorage.setItem(FORM_KEY, JSON.stringify(form)); } catch {}
  }, [form]);

  // ---- Cargar historial ----
  useEffect(() => {
    loadHistorial();
    loadUltimosDespachos();
  }, []);

  async function loadUltimosDespachos() {
    const { data } = await supabase
      .from("despachos")
      .select("id, fecha, hora, patente, articulo, toneladas, ton_final")
      .in("articulo", ["A36LGC", "A37LGC", "A38LGC", "A39LGC"])
      .order("fecha_hora", { ascending: false })
      .limit(100);
    if (data) setUltimosDespachos(data as typeof ultimosDespachos);
  }

  async function loadHistorial() {
    const { data } = await supabase
      .from("registros_arena")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(20);
    if (data && data.length > 0) {
      setHistorial(data);
      setPrevRow(data[0]);
    }
  }

  // ---- Validaciones contra registro anterior (al salir del campo) ----
  function checkInstrumento(campo: "pesometro" | "horometro") {
    if (!prevRow) return;
    const val = parseFloat(form[campo]);
    if (isNaN(val)) return;
    if (campo === "pesometro" && val <= prevRow.pesometro) {
      setWarnings((w) => ({ ...w, pesometro: `Pesómetro ingresado (${val.toLocaleString("es-CL")}) es igual o menor al anterior (${prevRow.pesometro.toLocaleString("es-CL")}). Es acumulativo y debe ser mayor.` }));
    }
    if (campo === "horometro" && val <= prevRow.horometro) {
      setWarnings((w) => ({ ...w, horometro: `Horómetro ingresado (${val.toLocaleString("es-CL")}) es igual o menor al anterior (${prevRow.horometro.toLocaleString("es-CL")}). Es acumulativo y debe ser mayor.` }));
    }
  }

  // ---- Despachos del período para el preview ----
  useEffect(() => {
    if (!prevRow || !form.fecha || !form.hora) {
      setPreviewDespachos({ ton: 0, viajes: 0 });
      return;
    }
    // Usar hora local (sin conversión UTC) — despachos en DB están en hora local
    const prevFH = `${prevRow.fecha}T${prevRow.hora.slice(0, 5)}:00`;
    const currFH = `${form.fecha}T${form.hora}:00`;
    supabase
      .from("despachos")
      .select("fecha, hora, articulo, toneladas, ton_final, folio")
      .in("articulo", ARTICULOS_ARENA_PROD)
      .gte("fecha_hora", addMinutes(prevFH, 15))
      .lte("fecha_hora", addMinutes(currFH, 15))
      .order("fecha_hora", { ascending: true })
      .then(({ data }) => {
        if (data) {
          type D = { fecha: string; hora: string; articulo: string | null; toneladas: number | null; ton_final: number | null; folio: number | null };
          const rows = data as D[];
          const a36 = rows.filter(d => d.articulo === "A36LGC");
          const a39 = rows.filter(d => d.articulo === "A39LGC");
          // Usar toneladas (romana) igual que Query1!O en el Excel
          const a36ton = a36.reduce((s, d) => s + (d.toneladas ?? 0), 0);
          const a39ton = a39.reduce((s, d) => s + (d.toneladas ?? 0), 0);
          setPreviewDespachos({
            ton: a36ton + a39ton,
            viajes: rows.length,
            a36ton, a36viajes: a36.length,
            a39ton, a39viajes: a39.length,
            rows,
          });
        }
      });
  }, [form.fecha, form.hora, prevRow]);

  // ---- Preview en tiempo real ----
  useEffect(() => {
    if (!form.pesometro || !form.horometro) { setPreview(null); return; }
    const input = formToInput(form);
    const prevInput = prevRow
      ? {
          fecha:     prevRow.fecha,
          hora:      prevRow.hora.slice(0, 5),
          pesometro: prevRow.pesometro,
          horometro: prevRow.horometro,
          fierrillo: prevRow.fierrillo,
          cono_1: prevRow.cono_1, cono_2: prevRow.cono_2, cono_3: prevRow.cono_3,
          pila_1: prevRow.pila_1, pila_2: prevRow.pila_2, pila_3: prevRow.pila_3,
          pila_4: prevRow.pila_4, pila_5: prevRow.pila_5, pila_6: prevRow.pila_6,
          pila_7: prevRow.pila_7,
          inventario_ton: prevRow.inventario_ton ?? 0,
        }
      : null;
    setPreview(calcularArena(input, prevInput, previewDespachos.ton, previewDespachos.viajes));
  }, [form, prevRow, previewDespachos]);

  // ---- Guardar ----
  async function handleSave() {
    if (!form.pesometro || !form.horometro) {
      setMsg({ type: "err", text: "Pesómetro y horómetro son obligatorios." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const input = formToInput(form);

      // Usar hora local (sin conversión UTC) — despachos en DB están en hora local
      const currFHLocal = `${input.fecha}T${input.hora}:00`;

      // Consultar despachos Arena entre droneo anterior y este
      const prevFHLocal = prevRow ? `${prevRow.fecha}T${prevRow.hora.slice(0, 5)}:00` : null;
      let despachosTon = 0;
      let despachosViajes = 0;

      if (prevFHLocal) {
        const { data: dsps } = await supabase
          .from("despachos")
          .select("toneladas")
          .in("articulo", ARTICULOS_ARENA_PROD)
          .gte("fecha_hora", addMinutes(prevFHLocal, 15))
          .lte("fecha_hora", addMinutes(currFHLocal, 15));

        if (dsps) {
          // Usar toneladas (romana) igual que Query1!O en el Excel
          despachosTon   = (dsps as { toneladas: number | null }[]).reduce((s, d) => s + (d.toneladas ?? 0), 0);
          despachosViajes = dsps.length;
        }
      }

      const prevInput = prevRow
        ? {
            fecha: prevRow.fecha, hora: prevRow.hora.slice(0, 5),
            pesometro: prevRow.pesometro, horometro: prevRow.horometro,
            fierrillo: prevRow.fierrillo,
            cono_1: prevRow.cono_1, cono_2: prevRow.cono_2, cono_3: prevRow.cono_3,
            pila_1: prevRow.pila_1, pila_2: prevRow.pila_2, pila_3: prevRow.pila_3,
            pila_4: prevRow.pila_4, pila_5: prevRow.pila_5, pila_6: prevRow.pila_6,
            pila_7: prevRow.pila_7,
            inventario_ton: prevRow.inventario_ton ?? 0,
          }
        : null;

      const calc = calcularArena(input, prevInput, despachosTon, despachosViajes);

      const { error } = await supabase.from("registros_arena").insert({
        fecha: input.fecha, hora: input.hora + ":00",
        fecha_hora: calc.fecha_hora,
        pesometro: input.pesometro,
        horometro: input.horometro,
        fierrillo: input.fierrillo,
        cono_1: input.cono_1, cono_2: input.cono_2, cono_3: input.cono_3,
        pila_1: input.pila_1, pila_2: input.pila_2, pila_3: input.pila_3,
        pila_4: input.pila_4, pila_5: input.pila_5, pila_6: input.pila_6,
        pila_7: input.pila_7,
        notas: form.notas || null,
        // Calculados
        diferencia_pesometro:    calc.diferencia_pesometro,
        produccion_pesometro:    calc.produccion_pesometro,
        diferencia_horometro:    calc.diferencia_horometro,
        horas_reales:            calc.horas_reales,
        detencion:               calc.detencion,
        despachos_ton:           calc.despachos_ton,
        cantidad_despachos:      calc.cantidad_despachos,
        conos:                   calc.conos,
        acopio:                  calc.acopio,
        inventario_m3:           calc.inventario_m3,
        inventario_ton:          calc.inventario_ton,
        diferencia_inventario:   calc.diferencia_inventario,
        produccion_drone:        calc.produccion_drone,
        productividad_drone:     calc.productividad_drone,
        productividad_pesometro: calc.productividad_pesometro,
        productividad_hrs_reales:calc.productividad_hrs_reales,
        diferencia:              calc.diferencia,
        cancha_vieja_ton:        calc.cancha_vieja_ton,
        cancha_nueva_ton:        calc.cancha_nueva_ton,
      });

      if (error) throw error;

      setMsg({ type: "ok", text: "✅ Registro guardado correctamente." });
      // Resetear formulario y limpiar borrador
      const reset = {
        fecha: today(), hora: nowTime(), pesometro: "", horometro: "", fierrillo: "0",
        cono_1:"", cono_2:"", cono_3:"",
        pila_1:"", pila_2:"", pila_3:"", pila_4:"",
        pila_5:"", pila_6:"", pila_7:"",
        notas:"",
      };
      setForm(reset);
      try { localStorage.setItem(FORM_KEY, JSON.stringify(reset)); } catch {}
      await loadHistorial();
    } catch (e: unknown) {
      setMsg({ type: "err", text: `Error: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  // ---- Sincronizar Despachos desde SharePoint ----
  async function handleSyncDespachos() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/despachos/sync-sharepoint", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        const detail = json.errors?.[0] ?? json.error ?? json.message ?? "Error al sincronizar despachos";
        setMsg({ type: "err", text: detail });
      } else {
        setMsg({ type: "ok", text: `✅ ${json.message}` });
        await loadUltimosDespachos();
      }
    } catch (e: unknown) {
      setMsg({ type: "err", text: `Error: ${(e as Error).message}` });
    } finally {
      setSyncing(false);
    }
  }

  function set(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">⛏ Ingreso Datos Arena</h1>
          <p className="text-sm text-gray-500">
            Registro anterior: {prevRow
              ? `${prevRow.fecha} ${prevRow.hora?.slice(0,5)} — Pesómetro: ${prevRow.pesometro?.toLocaleString("es-CL")}`
              : "Sin datos previos"}
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-sm font-medium hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={handleSyncDespachos}
          disabled={syncing}
          title="Sincroniza los despachos desde SALIDAS ROMANAS.xlsx en SharePoint"
        >
          {syncing ? (
            <span className="animate-spin text-base">⟳</span>
          ) : (
            <span>🔄</span>
          )}
          {syncing ? "Sincronizando..." : "Actualizar Despachos"}
        </button>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
        }`}>
          {msg.text}
        </div>
      )}

      {/* Popup compacto de advertencia de instrumentos */}
      {(warnings.pesometro || warnings.horometro) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24"
          onClick={() => setWarnings({})}>
          <div className="bg-white border border-amber-300 rounded-lg shadow-xl w-80 mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="bg-amber-400 px-3 py-2 flex items-center justify-between">
              <span className="text-white font-semibold text-sm">⚠️ Valor fuera de rango</span>
              <button className="text-white/80 hover:text-white text-lg leading-none" onClick={() => setWarnings({})}>×</button>
            </div>
            <div className="px-3 py-2 space-y-2">
              {warnings.pesometro && (
                <p className="text-xs text-gray-700"><span className="font-semibold text-amber-700">Pesómetro:</span> {warnings.pesometro}</p>
              )}
              {warnings.horometro && (
                <p className="text-xs text-gray-700"><span className="font-semibold text-amber-700">Horómetro:</span> {warnings.horometro}</p>
              )}
            </div>
            <div className="px-3 pb-2">
              <button className="w-full py-1.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold hover:bg-amber-200 transition-colors"
                onClick={() => setWarnings({})}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario */}
        <div className="lg:col-span-2 space-y-4">

          {/* Fecha y hora */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-1">📅 Fecha y hora del droneo</h2>
            <p className="text-xs text-blue-500 mb-3">
              Ingresa la fecha y hora real del vuelo, aunque lo estés registrando después.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Fecha del droneo</label>
                <input type="date" className="input" value={form.fecha} onChange={set("fecha")} />
              </div>
              <div>
                <label className="label">Hora del droneo</label>
                <input type="time" className="input" value={form.hora}  onChange={set("hora")} />
              </div>
            </div>
          </div>

          {/* Instrumentos */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-3">🔧 Instrumentos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Pesómetro</label>
                <input type="number" className="input" placeholder="327729" value={form.pesometro} onChange={set("pesometro")} onBlur={() => checkInstrumento("pesometro")} />
              </div>
              <div>
                <label className="label">Horómetro</label>
                <input type="number" className="input" placeholder="47280" value={form.horometro} onChange={set("horometro")} onBlur={() => checkInstrumento("horometro")} />
              </div>
              <div>
                <label className="label">Fierrillo (m³)</label>
                <input type="number" className="input" placeholder="0" value={form.fierrillo} onChange={set("fierrillo")} step="0.01" />
              </div>
            </div>
          </div>

          {/* Cancha Vieja (drone) */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-1">⛰ Cancha Vieja – Volumen drone (m³)</h2>
            <p className="text-xs text-gray-400 mb-3">Densidad: ×1.4 al calcular toneladas</p>
            <div className="grid grid-cols-3 gap-3">
              {CONOS.map((n) => (
                <div key={n}>
                  <label className="label">Acopio {n}</label>
                  <input type="number" className="input" placeholder="0" step="0.01"
                    value={form[`cono_${n}`]} onChange={set(`cono_${n}`)} />
                </div>
              ))}
            </div>
          </div>

          {/* Cancha Nueva (drone) */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-1">🏔 Cancha Nueva – Volumen drone (m³)</h2>
            <p className="text-xs text-gray-400 mb-3">Densidad: ×1.4 al calcular toneladas</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([1, 2, 3, 4] as const).map((n) => (
                <div key={n}>
                  <label className="label">Acopio {n + 3}</label>
                  <input type="number" className="input" placeholder="0" step="0.01"
                    value={form[`pila_${n}`]} onChange={set(`pila_${n}`)} />
                </div>
              ))}
            </div>
          </div>

          {/* Riñones (drone) */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-1">💎 Riñones – Volumen drone (m³)</h2>
            <p className="text-xs text-gray-400 mb-3">Densidad: ×1.4 al calcular toneladas</p>
            <div className="grid grid-cols-3 gap-3">
              {([5, 6, 7] as const).map((n, i) => (
                <div key={n}>
                  <label className="label">R{i + 1}</label>
                  <input type="number" className="input" placeholder="0" step="0.01"
                    value={form[`pila_${n}`]} onChange={set(`pila_${n}`)} />
                </div>
              ))}
            </div>
          </div>

          {/* Notas */}
          <div className="card">
            <label className="label">Notas / Observaciones</label>
            <textarea className="input" rows={2} value={form.notas} onChange={set("notas")}
              placeholder="Observaciones opcionales..." />
          </div>

          {/* Botón guardar */}
          <button className="btn-primary w-full py-3 text-base" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "💾 Guardar Registro"}
          </button>
        </div>

        {/* Columna derecha */}
        <div className="space-y-4">
          {/* Últimos despachos */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-2 text-sm">📋 Últimos despachos</h2>
            {ultimosDespachos.length === 0 ? (
              <p className="text-xs text-gray-400">Sin despachos cargados</p>
            ) : (
              <div className="overflow-y-auto max-h-52 text-xs">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-100 text-gray-400">
                      <th className="text-left py-1 pr-2 font-medium">Fecha</th>
                      <th className="text-left py-1 pr-2 font-medium">Patente</th>
                      <th className="text-left py-1 pr-2 font-medium">Art.</th>
                      <th className="text-right py-1 font-medium">Ton</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ultimosDespachos.map((d) => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="py-1 pr-2 text-gray-600">{d.fecha} {d.hora?.slice(0,5)}</td>
                        <td className="py-1 pr-2 font-mono text-gray-700">{d.patente ?? "—"}</td>
                        <td className="py-1 pr-2">
                          <span className={`px-1 rounded text-[10px] font-semibold ${
                            d.articulo === "A36LGC" ? "bg-blue-100 text-blue-700" :
                            d.articulo === "A39LGC" ? "bg-green-100 text-green-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>{d.articulo?.replace("LGC","") ?? "—"}</span>
                        </td>
                        <td className="py-1 text-right font-semibold text-gray-800">
                          {(d.ton_final ?? d.toneladas ?? 0).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-gray-300 mt-1">Últimos 100 · A36/A37/A38/A39</p>
          </div>

          {/* Preview calculado */}
          <div className="card sticky top-20">
            <h2 className="font-semibold text-gray-700 mb-2">📊 Preview calculado</h2>

            {/* Indicador de período */}
            {prevRow ? (
              <div className={`text-xs rounded-md px-3 py-2 mb-3 leading-relaxed ${
                preview && preview.horas_reales > 48
                  ? "bg-amber-50 text-amber-700"
                  : "bg-gray-50 text-gray-500"
              }`}>
                <span className="font-semibold">Período:</span>{" "}
                {prevRow.fecha} {prevRow.hora?.slice(0,5)}
                {" → "}
                {form.fecha} {form.hora}
                {preview && (
                  <span className="ml-1">
                    ({fmt(preview.horas_reales, 1)} h)
                    {preview.horas_reales > 48 && (
                      <span className="ml-1">⚠ Verifica la fecha del droneo</span>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-md px-3 py-2 mb-3">
                Sin registro anterior — primer droneo
              </p>
            )}

            {preview ? (
              <div className="space-y-1.5 text-sm">

                {/* ── Bloque 1: Instrumentos ── */}
                <PreviewRow label="Diff Pesómetro"  value={fmt(preview.diferencia_pesometro)} unit="unid." />
                <PreviewRow label="Prod. Pesómetro" value={fmt(preview.produccion_pesometro)} unit="ton" />
                <PreviewRow label="Diff Horómetro"  value={fmt(preview.diferencia_horometro, 1)} unit="h" />
                <PreviewRow label="Horas Reales"    value={fmt(preview.horas_reales, 1)} unit="h" />
                <PreviewRow label="Detención"       value={fmt(preview.detencion, 1)} unit="h" />

                <div className="border-t-2 border-gray-300 my-1" />

                {/* ── Despachos del período ── */}
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Despachos del período</p>
                <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1.5">
                  {/* Totales */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">Total</span>
                    <span className="font-bold text-gray-800 tabular-nums text-sm">
                      {fmt(previewDespachos.ton)} ton · {previewDespachos.viajes} viajes
                    </span>
                  </div>
                  {/* Desglose por artículo */}
                  {previewDespachos.viajes > 0 && (
                    <div className="border-t border-gray-200 pt-1 space-y-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-blue-600 font-medium">A36 Arena</span>
                        <span className="text-[10px] text-gray-700 tabular-nums">
                          {fmt(previewDespachos.a36ton)} t · {previewDespachos.a36viajes} v
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-green-600 font-medium">A39</span>
                        <span className="text-[10px] text-gray-700 tabular-nums">
                          {fmt(previewDespachos.a39ton)} t · {previewDespachos.a39viajes} v
                        </span>
                      </div>
                    </div>
                  )}
                  {previewDespachos.viajes === 0 && (
                    <p className="text-[10px] text-gray-400">Sin despachos en el período</p>
                  )}
                  {previewDespachos.viajes > 0 && (
                    <button
                      className="text-[10px] text-blue-500 hover:underline mt-0.5"
                      onClick={() => setShowDespDebug(v => !v)}>
                      {showDespDebug ? "▲ Ocultar detalle" : "▼ Ver detalle por viaje"}
                    </button>
                  )}
                </div>

                {/* Tabla debug despachos */}
                {showDespDebug && previewDespachos.rows.length > 0 && (
                  <div className="overflow-y-auto max-h-48 border border-gray-200 rounded-lg text-[10px]">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-gray-100">
                        <tr className="text-gray-500">
                          <th className="text-left px-1.5 py-1">Fecha</th>
                          <th className="text-left px-1.5 py-1">Hora</th>
                          <th className="text-left px-1.5 py-1">Art.</th>
                          <th className="text-right px-1.5 py-1">Ton Final</th>
                          <th className="text-right px-1.5 py-1">Toneladas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {previewDespachos.rows.map((d, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-1.5 py-0.5 text-gray-700">{d.fecha}</td>
                            <td className="px-1.5 py-0.5 text-gray-600">{d.hora?.slice(0,5)}</td>
                            <td className="px-1.5 py-0.5">
                              <span className={`font-semibold ${d.articulo === "A36LGC" ? "text-blue-600" : "text-green-600"}`}>
                                {d.articulo?.replace("LGC","")}
                              </span>
                            </td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums font-semibold text-gray-800">
                              {d.ton_final?.toLocaleString("es-CL",{minimumFractionDigits:1}) ?? "—"}
                            </td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums text-gray-500">
                              {d.toneladas?.toLocaleString("es-CL",{minimumFractionDigits:1}) ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="border-t-2 border-gray-300 my-1" />

                {/* ── Bloque 2: Producción ── */}
                <PreviewRow label="Prod. Drone"       value={fmt(preview.produccion_drone)} unit="ton" />
                <PreviewRow label="Productividad"     value={fmt(preview.productividad_drone)} unit="ton/h" colorClass={prodColor(preview.productividad_drone)} />
                <PreviewRow label="Prodvd Hrs Reales" value={fmt(preview.productividad_hrs_reales)} unit="ton/h" colorClass={prodColor(preview.productividad_hrs_reales)} />
                <PreviewRow label="Diferencia"        value={`${fmt(preview.diferencia * 100, 1)}%`} unit="" />

                <div className="border-t-2 border-gray-300 my-1" />

                {/* ── Tabla resumen inventario por cancha ── */}
                <table className="w-full text-xs mt-0.5">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-200">
                      <th className="text-left font-medium pb-1">Cancha</th>
                      <th className="text-right font-medium pb-1">m³</th>
                      <th className="text-right font-medium pb-1">Ton</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr>
                      <td className="py-0.5 text-gray-600">⛰ Vieja</td>
                      <td className="py-0.5 text-right tabular-nums text-gray-800">{fmt(preview.cancha_vieja_m3, 0)}</td>
                      <td className="py-0.5 text-right tabular-nums font-semibold text-gray-800">{fmt(preview.cancha_vieja_ton)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-gray-600">🏔 Nueva</td>
                      <td className="py-0.5 text-right tabular-nums text-gray-800">{fmt(preview.cancha_nueva_m3, 0)}</td>
                      <td className="py-0.5 text-right tabular-nums font-semibold text-gray-800">{fmt(preview.cancha_nueva_ton)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-gray-600">💎 Riñones</td>
                      <td className="py-0.5 text-right tabular-nums text-gray-800">{fmt(preview.rinones_m3, 0)}</td>
                      <td className="py-0.5 text-right tabular-nums font-semibold text-gray-800">{fmt(preview.rinones_ton)}</td>
                    </tr>
                    <tr className="border-t-2 border-gray-300">
                      <td className="pt-1 font-bold text-gray-800">Total</td>
                      <td className="pt-1 text-right tabular-nums font-bold text-gray-800">{fmt(preview.inventario_m3, 0)}</td>
                      <td className={`pt-1 text-right tabular-nums font-bold ${invColor(preview.inventario_ton)}`}>{fmt(preview.inventario_ton)}</td>
                    </tr>
                    <tr>
                      <td className="pt-0.5 text-gray-500">Diff Inventario</td>
                      <td className="pt-0.5 text-right tabular-nums text-gray-400">—</td>
                      <td className="pt-0.5 text-right tabular-nums font-semibold text-gray-800">{fmt(preview.diferencia_inventario)}</td>
                    </tr>
                  </tbody>
                </table>

                <p className="text-[10px] text-gray-400 pt-1">
                  Inv: meta 7.500 t · Prod: meta 32 t/h · verde ≥95% · ámbar ≥90% · rojo &lt;90%
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Ingresa Pesómetro y Horómetro para ver preview</p>
            )}
          </div>
        </div>
      </div>

      {/* Historial */}
      <section className="card overflow-auto">
        <h2 className="font-semibold text-gray-800 mb-3">Historial reciente</h2>
        <table className="w-full min-w-[700px] text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Pesómetro</th>
              <th className="table-th">Inv. Ton</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Prodvd</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {historial.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="table-td-left font-medium">{r.fecha} {r.hora?.slice(0,5)}</td>
                <td className="table-td">{r.pesometro?.toLocaleString("es-CL")}</td>
                <td className="table-td text-blue-700">{fmt(r.inventario_ton)}</td>
                <td className="table-td text-green-700 font-semibold">{fmt(r.produccion_drone)}</td>
                <td className="table-td">{fmt(r.despachos_ton)}</td>
                <td className="table-td">{fmt(r.productividad_drone)} t/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
    </AdminGuard>
  );
}

// ── Metas de control ──────────────────────────────────────
// Inventario: meta mínima 7.500 ton
// Productividad: meta 32 ton/h
// Criterio: ≥95% meta → verde | ≥90% → ámbar | <90% → rojo
function invColor(invTon: number): string {
  const r = invTon / 7500;
  if (r >= 0.95) return "text-green-600";
  if (r >= 0.90) return "text-amber-600";
  return "text-red-600";
}
function prodColor(prodv: number): string {
  const r = prodv / 32;
  if (r >= 0.95) return "text-green-600";
  if (r >= 0.90) return "text-amber-600";
  return "text-red-600";
}

function PreviewRow({ label, value, unit, colorClass }: {
  label: string; value: string; unit: string; colorClass?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold tabular-nums ${colorClass ?? "text-gray-800"}`}>
        {value}{unit && <span className="text-gray-400 font-normal text-xs ml-1">{unit}</span>}
      </span>
    </div>
  );
}

