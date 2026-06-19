"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase } from "@/lib/supabase";
import {
  calcularArena, fmt, ARTICULO_ARENA,
  type ArenaInput,
} from "@/lib/calculations";
import type { RegistroArena } from "@/types/database";
import { format } from "date-fns";

const PILAS = [1, 2, 3, 4, 5, 6, 7] as const;
const CONOS = [1, 2, 3] as const;

const today = () => format(new Date(), "yyyy-MM-dd");
const nowTime = () => format(new Date(), "HH:mm");

export default function ArenaPage() {
  const [form, setForm] = useState<Record<string, string>>({
    fecha:    today(),
    hora:     nowTime(),
    pesometro:"",
    horometro:"",
    fierrillo:"0",
    cono_1: "", cono_2: "", cono_3: "",
    pila_1: "", pila_2: "", pila_3: "", pila_4: "",
    pila_5: "", pila_6: "", pila_7: "",
    notas: "",
  });

  const [historial, setHistorial] = useState<RegistroArena[]>([]);
  const [prevRow, setPrevRow]     = useState<(RegistroArena) | null>(null);
  const [preview, setPreview]     = useState<ReturnType<typeof calcularArena> | null>(null);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ---- Cargar historial ----
  useEffect(() => {
    loadHistorial();
  }, []);

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
    setPreview(calcularArena(input, prevInput, 0, 0)); // despachos se calculan al guardar
  }, [form, prevRow]);

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
      const fechaHora = new Date(`${input.fecha}T${input.hora}:00`).toISOString();

      // Consultar despachos Arena entre droneo anterior y este
      const prevFH = prevRow?.fecha_hora;
      let despachosTon = 0;
      let despachosViajes = 0;

      if (prevFH) {
        const { data: dsps } = await supabase
          .from("despachos")
          .select("ton_final")
          .eq("articulo", ARTICULO_ARENA)
          .gte("fecha_hora", addMinutes(prevFH, 15))
          .lte("fecha_hora", addMinutes(fechaHora, 15));

        if (dsps) {
          despachosTon   = (dsps as { ton_final: number | null }[]).reduce((s, d) => s + (d.ton_final ?? 0), 0);
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
      // Resetear formulario con nueva fecha/hora
      setForm((f) => ({
        ...f,
        fecha: today(), hora: nowTime(),
        pesometro: "", horometro: "", fierrillo: "0",
        cono_1:"", cono_2:"", cono_3:"",
        pila_1:"", pila_2:"", pila_3:"", pila_4:"",
        pila_5:"", pila_6:"", pila_7:"",
        notas:"",
      }));
      await loadHistorial();
    } catch (e: unknown) {
      setMsg({ type: "err", text: `Error: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  function set(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">⛏ Ingreso Datos Arena</h1>
        <p className="text-sm text-gray-500">
          Registro anterior: {prevRow
            ? `${prevRow.fecha} ${prevRow.hora?.slice(0,5)} — Pesómetro: ${prevRow.pesometro?.toLocaleString("es-CL")}`
            : "Sin datos previos"}
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
        }`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario */}
        <div className="lg:col-span-2 space-y-4">

          {/* Fecha y hora */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-3">📅 Fecha y hora del droneo</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input" value={form.fecha} onChange={set("fecha")} />
              </div>
              <div>
                <label className="label">Hora</label>
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
                <input type="number" className="input" placeholder="327729" value={form.pesometro} onChange={set("pesometro")} />
              </div>
              <div>
                <label className="label">Horómetro</label>
                <input type="number" className="input" placeholder="47280" value={form.horometro} onChange={set("horometro")} />
              </div>
              <div>
                <label className="label">Fierrillo (m³)</label>
                <input type="number" className="input" placeholder="0" value={form.fierrillo} onChange={set("fierrillo")} step="0.01" />
              </div>
            </div>
          </div>

          {/* Conos (drone) */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-1">🗄 Conos – Volumen drone (m³)</h2>
            <p className="text-xs text-gray-400 mb-3">Factor de compactación: ×0.9 al calcular inventario</p>
            <div className="grid grid-cols-3 gap-3">
              {CONOS.map((n) => (
                <div key={n}>
                  <label className="label">Cono {n}</label>
                  <input type="number" className="input" placeholder="0" step="0.01"
                    value={form[`cono_${n}`]} onChange={set(`cono_${n}`)} />
                </div>
              ))}
            </div>
          </div>

          {/* Pilas (drone) */}
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-3">📦 Pilas / Acopio – Volumen drone (m³)</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {PILAS.map((n) => (
                <div key={n}>
                  <label className="label">Pila {n}</label>
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

        {/* Preview calculado */}
        <div className="space-y-4">
          <div className="card sticky top-20">
            <h2 className="font-semibold text-gray-700 mb-3">📊 Preview calculado</h2>
            {preview ? (
              <div className="space-y-2 text-sm">
                <PreviewRow label="Diff Pesómetro"     value={fmt(preview.diferencia_pesometro)} unit="unid." />
                <PreviewRow label="Prod. Pesómetro"    value={fmt(preview.produccion_pesometro)} unit="ton" highlight />
                <PreviewRow label="Diff Horómetro"     value={fmt(preview.diferencia_horometro, 1)} unit="h" />
                <PreviewRow label="Horas reales"       value={fmt(preview.horas_reales, 1)} unit="h" />
                <PreviewRow label="Detención"          value={fmt(preview.detencion, 1)} unit="h" />
                <hr className="border-gray-100" />
                <PreviewRow label="Conos"              value={fmt(preview.conos)} unit="m³" />
                <PreviewRow label="Acopio (pilas)"     value={fmt(preview.acopio)} unit="m³" />
                <PreviewRow label="Inventario M³"      value={fmt(preview.inventario_m3)} unit="m³" />
                <PreviewRow label="Inventario Ton"     value={fmt(preview.inventario_ton)} unit="ton" highlight />
                <PreviewRow label="Diff Inventario"    value={fmt(preview.diferencia_inventario)} unit="ton" />
                <hr className="border-gray-100" />
                <PreviewRow label="Prod. Drone"        value={fmt(preview.produccion_drone)} unit="ton" highlight />
                <PreviewRow label="Productividad"      value={fmt(preview.productividad_drone)} unit="ton/h" />
                <PreviewRow label="Prodvd Hrs Reales"  value={fmt(preview.productividad_hrs_reales)} unit="ton/h" />
                <PreviewRow label="Diferencia"         value={`${fmt(preview.diferencia * 100, 1)}%`} unit="" />
                <hr className="border-gray-100" />
                <PreviewRow label="Cancha Vieja"       value={fmt(preview.cancha_vieja_ton)} unit="ton" />
                <PreviewRow label="Cancha Nueva"       value={fmt(preview.cancha_nueva_ton)} unit="ton" />
                <p className="text-xs text-gray-400 pt-2">* Despachos se calculan al guardar</p>
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

function PreviewRow({ label, value, unit, highlight }: {
  label: string; value: string; unit: string; highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold tabular-nums ${highlight ? "text-orange-600" : "text-gray-800"}`}>
        {value} <span className="text-gray-400 font-normal text-xs">{unit}</span>
      </span>
    </div>
  );
}

function formToInput(f: Record<string, string>): ArenaInput {
  return {
    fecha: f.fecha, hora: f.hora,
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

function addMinutes(isoStr: string, min: number): string {
  return new Date(new Date(isoStr).getTime() + min * 60 * 1000).toISOString();
}
