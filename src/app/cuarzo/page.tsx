"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AdminGuard } from "@/components/AdminGuard";
import { EditCuarzoModal } from "@/components/EditCuarzoModal";
import { supabase } from "@/lib/supabase";
import {
  calcularCuarzo, fmt, ARTICULO_CUARZO,
  type CuarzoInput,
} from "@/lib/calculations";
import type { RegistroCuarzo } from "@/types/database";
import { format } from "date-fns";

const today   = () => format(new Date(), "yyyy-MM-dd");
const nowTime = () => format(new Date(), "HH:mm");

export default function CuarzoPage() {
  const [form, setForm] = useState<Record<string, string>>({
    fecha:    today(),
    hora:     nowTime(),
    pesometro:"",
    horometro:"",
    cono_1:   "",
    cono_2:   "0",
    cono_3:   "0",
    notas:    "",
  });

  const { data: session }         = useSession();
  const [historial, setHistorial] = useState<RegistroCuarzo[]>([]);
  const [prevRow, setPrevRow]     = useState<RegistroCuarzo | null>(null);
  const [preview, setPreview]     = useState<ReturnType<typeof calcularCuarzo> | null>(null);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editRow, setEditRow]     = useState<RegistroCuarzo | null>(null);

  useEffect(() => { loadHistorial(); }, []);

  async function loadHistorial() {
    const { data } = await supabase
      .from("registros_cuarzo")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(20);
    if (data && data.length > 0) {
      setHistorial(data);
      setPrevRow(data[0]);
    }
  }

  useEffect(() => {
    if (!form.horometro) { setPreview(null); return; }
    const input = formToInput(form);
    const prevInput = prevRow
      ? {
          fecha: prevRow.fecha, hora: prevRow.hora.slice(0, 5),
          pesometro: prevRow.pesometro,
          horometro: prevRow.horometro,
          cono_1: prevRow.cono_1, cono_2: prevRow.cono_2, cono_3: prevRow.cono_3,
          inventario_ton: prevRow.inventario_ton ?? 0,
        }
      : null;
    setPreview(calcularCuarzo(input, prevInput, 0, 0));
  }, [form, prevRow]);

  async function handleSave() {
    if (!form.horometro) { setMsg({ type:"err", text:"Horómetro es obligatorio." }); return; }
    setSaving(true); setMsg(null);
    try {
      const input     = formToInput(form);
      const fechaHora = new Date(`${input.fecha}T${input.hora}:00`).toISOString();
      const prevFH    = prevRow?.fecha_hora;
      let despachosTon = 0, despachosViajes = 0;

      if (prevFH) {
        const { data: dsps } = await supabase
          .from("despachos")
          .select("ton_final")
          .eq("articulo", ARTICULO_CUARZO)
          .gte("fecha_hora", addMinutes(prevFH, 15))
          .lte("fecha_hora", addMinutes(fechaHora, 15));
        if (dsps) {
          despachosTon    = dsps.reduce((s, d) => s + (d.ton_final ?? 0), 0);
          despachosViajes = dsps.length;
        }
      }

      const prevInput = prevRow
        ? {
            fecha: prevRow.fecha, hora: prevRow.hora.slice(0, 5),
            pesometro: prevRow.pesometro, horometro: prevRow.horometro,
            cono_1: prevRow.cono_1, cono_2: prevRow.cono_2, cono_3: prevRow.cono_3,
            inventario_ton: prevRow.inventario_ton ?? 0,
          }
        : null;

      const calc = calcularCuarzo(input, prevInput, despachosTon, despachosViajes);

      const { error } = await supabase.from("registros_cuarzo").insert({
        fecha: input.fecha, hora: input.hora + ":00",
        fecha_hora: calc.fecha_hora,
        pesometro:  input.pesometro,
        horometro:  input.horometro,
        cono_1: input.cono_1, cono_2: input.cono_2, cono_3: input.cono_3,
        notas: form.notas || null,
        diferencia_pesometro:    calc.diferencia_pesometro,
        produccion_pesometro:    calc.produccion_pesometro,
        diferencia_horometro:    calc.diferencia_horometro,
        horas_reales:            calc.horas_reales,
        detencion:               calc.detencion,
        despachos_ton:           calc.despachos_ton,
        cantidad_despachos:      calc.cantidad_despachos,
        conos:                   calc.conos,
        inventario_m3:           calc.inventario_m3,
        inventario_ton:          calc.inventario_ton,
        diferencia_inventario:   calc.diferencia_inventario,
        produccion_drone:        calc.produccion_drone,
        productividad_drone:     calc.productividad_drone,
        productividad_pesometro: calc.productividad_pesometro,
        productividad_hrs_reales:calc.productividad_hrs_reales,
        diferencia:              calc.diferencia,
      });

      if (error) throw error;
      setMsg({ type:"ok", text:"✅ Registro guardado." });
      setForm((f) => ({ ...f, fecha:today(), hora:nowTime(), pesometro:"", horometro:"", cono_1:"", cono_2:"0", cono_3:"0", notas:"" }));
      await loadHistorial();
    } catch (e: unknown) {
      setMsg({ type:"err", text:`Error: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🪨 Ingreso Datos Cuarzo</h1>
        <p className="text-sm text-gray-500">
          Registro anterior: {prevRow
            ? `${prevRow.fecha} ${prevRow.hora?.slice(0,5)} — Horómetro: ${prevRow.horometro?.toLocaleString("es-CL")}`
            : "Sin datos previos"}
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          msg.type==="ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
        }`}>{msg.text}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-3">📅 Fecha y hora</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Fecha</label>
                <input type="date" className="input" value={form.fecha} onChange={set("fecha")} /></div>
              <div><label className="label">Hora</label>
                <input type="time" className="input" value={form.hora}  onChange={set("hora")} /></div>
            </div>
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-3">🔧 Instrumentos</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Pesómetro</label>
                <input type="number" className="input" placeholder="810205" value={form.pesometro} onChange={set("pesometro")} /></div>
              <div><label className="label">Horómetro</label>
                <input type="number" className="input" placeholder="12838" value={form.horometro} onChange={set("horometro")} step="0.1" /></div>
            </div>
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-700 mb-1">🗄 Volumen drone (m³)</h2>
            <p className="text-xs text-gray-400 mb-3">Densidad Cuarzo: 1.65 ton/m³</p>
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3].map((n) => (
                <div key={n}><label className="label">Cono {n}</label>
                  <input type="number" className="input" placeholder="0" step="0.01"
                    value={form[`cono_${n}`]} onChange={set(`cono_${n}`)} /></div>
              ))}
            </div>
          </div>

          <div className="card">
            <label className="label">Notas</label>
            <textarea className="input" rows={2} value={form.notas} onChange={set("notas")} placeholder="Observaciones opcionales..." />
          </div>

          <button className="btn-primary w-full py-3 text-base" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "💾 Guardar Registro"}
          </button>
        </div>

        <div>
          <div className="card sticky top-20">
            <h2 className="font-semibold text-gray-700 mb-3">📊 Preview</h2>
            {preview ? (
              <div className="space-y-2 text-sm">
                <PreviewRow label="Prod. Pesómetro" value={fmt(preview.produccion_pesometro)} unit="ton" highlight />
                <PreviewRow label="Diff Horómetro"  value={fmt(preview.diferencia_horometro, 1)} unit="h" />
                <PreviewRow label="Horas reales"    value={fmt(preview.horas_reales, 1)} unit="h" />
                <PreviewRow label="Detención"       value={fmt(preview.detencion, 1)} unit="h" />
                <hr className="border-gray-100" />
                <PreviewRow label="Conos m³"        value={fmt(preview.conos)} unit="m³" />
                <PreviewRow label="Inventario Ton"  value={fmt(preview.inventario_ton)} unit="ton" highlight />
                <PreviewRow label="Diff Inventario" value={fmt(preview.diferencia_inventario)} unit="ton" />
                <hr className="border-gray-100" />
                <PreviewRow label="Prod. Drone"     value={fmt(preview.produccion_drone)} unit="ton" highlight />
                <PreviewRow label="Productividad"   value={fmt(preview.productividad_drone)} unit="ton/h" />
              </div>
            ) : <p className="text-sm text-gray-400">Ingresa el horómetro para ver preview</p>}
          </div>
        </div>
      </div>

      <section className="card overflow-auto">
        <h2 className="font-semibold text-gray-800 mb-3">Historial reciente</h2>
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Horómetro</th>
              <th className="table-th">Inv. Ton</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Productividad</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {historial.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="table-td-left font-medium">{r.fecha} {r.hora?.slice(0,5)}</td>
                <td className="table-td">{r.horometro?.toLocaleString("es-CL")}</td>
                <td className="table-td text-blue-700">{fmt(r.inventario_ton)}</td>
                <td className="table-td text-green-700 font-semibold">{fmt(r.produccion_drone)}</td>
                <td className="table-td">{fmt(r.despachos_ton)}</td>
                <td className="table-td">{fmt(r.productividad_drone)} t/h</td>
                <td className="table-td">
                  <button
                    onClick={() => setEditRow(r)}
                    className="text-gray-400 hover:text-migrin transition-colors"
                    title="Editar registro"
                  >✏️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>

    {editRow && (
      <EditCuarzoModal
        registro={editRow}
        userEmail={session?.user?.email ?? ""}
        onClose={() => setEditRow(null)}
        onSaved={() => { setEditRow(null); loadHistorial(); }}
      />
    )}
    </AdminGuard>
  );
}

function PreviewRow({ label, value, unit, highlight }: {
  label: string; value: string; unit: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={"font-semibold tabular-nums " + (highlight ? "text-migrin" : "text-gray-800")}>
        {value} <span className="text-xs font-normal text-gray-400">{unit}</span>
      </span>
    </div>
  );
}

function addMinutes(isoStr: string, min: number): string {
  return new Date(new Date(isoStr).getTime() + min * 60000).toISOString();
}
