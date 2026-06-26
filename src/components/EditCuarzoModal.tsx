"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RegistroCuarzo } from "@/types/database";

interface Props {
  registro: RegistroCuarzo;
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

const CAMPOS_EDITABLES = [
  { key: "fecha",     label: "Fecha",      type: "date"   },
  { key: "hora",      label: "Hora",       type: "time"   },
  { key: "cono_1",    label: "Cono 1 (m3)", type: "number" },
  { key: "cono_2",    label: "Cono 2 (m3)", type: "number" },
  { key: "cono_3",    label: "Cono 3 (m3)", type: "number" },
  { key: "notas",     label: "Notas",      type: "text"   },
] as const;

export function EditCuarzoModal({ registro, userEmail, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of CAMPOS_EDITABLES) {
      const v = registro[c.key as keyof RegistroCuarzo];
      init[c.key] = v != null ? String(v) : "";
    }
    if (init.hora && init.hora.length > 5) init.hora = init.hora.slice(0, 5);
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);

    const cambios: { campo: string; anterior: string; nuevo: string }[] = [];
    for (const c of CAMPOS_EDITABLES) {
      const anterior = registro[c.key as keyof RegistroCuarzo];
      const anteriorStr = anterior != null ? String(anterior) : "";
      const valorAnterior = c.key === "hora" && anteriorStr.length > 5 ? anteriorStr.slice(0, 5) : anteriorStr;
      const valorNuevo = form[c.key] ?? "";
      if (valorAnterior !== valorNuevo) {
        cambios.push({ campo: c.key, anterior: valorAnterior, nuevo: valorNuevo });
      }
    }

    if (cambios.length === 0) { onClose(); return; }

    const update: Record<string, unknown> = {};
    for (const ch of cambios) {
      if (ch.campo === "fecha" || ch.campo === "notas") {
        update[ch.campo] = ch.nuevo;
      } else if (ch.campo === "hora") {
        update[ch.campo] = ch.nuevo + ":00";
      } else {
        update[ch.campo] = ch.nuevo === "" ? null : parseFloat(ch.nuevo);
      }
    }

    const nuevaFecha = (update.fecha as string) ?? registro.fecha;
    const nuevaHora  = form.hora ?? (registro.hora ?? "").slice(0, 5);
    if (cambios.some(c => c.campo === "fecha" || c.campo === "hora")) {
      update.fecha_hora = new Date(`${nuevaFecha}T${nuevaHora}:00`).toISOString();
    }
    update.updated_at = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from("registros_cuarzo")
      .update(update)
      .eq("id", registro.id);

    if (updateErr) { setError(updateErr.message); setSaving(false); return; }

    const historial = cambios.map(ch => ({
      tabla:          "registros_cuarzo",
      registro_id:    registro.id,
      campo:          ch.campo,
      valor_anterior: ch.anterior,
      valor_nuevo:    ch.nuevo,
      usuario_email:  userEmail,
    }));
    await supabase.from("historial_cambios").insert(historial);

    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800"> Editar registro Cuarzo</h2>
            <p className="text-xs text-gray-400">{registro.fecha} {(registro.hora ?? "").slice(0, 5)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none"></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 flex-1">
          <div className="grid grid-cols-2 gap-3">
            {CAMPOS_EDITABLES.map(({ key, label, type }) => (
              <div key={key} className={key === "notas" ? "col-span-2" : ""}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                {type === "text" ? (
                  <textarea
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  />
                ) : (
                  <input
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          {error && <p className="mt-3 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancelar</button>
          <button onClick={handleSave} className="btn-primary" disabled={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
