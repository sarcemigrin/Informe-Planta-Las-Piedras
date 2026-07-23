"use client";


import { useEffect, useState } from "react";
import { useSession }          from "next-auth/react";
import { AdminGuard }          from "@/components/AdminGuard";
import { supabase }            from "@/lib/supabase";
import { format }              from "date-fns";
import type { RegistroTurco, RegistroPeral } from "@/types/database";

type Tab = "turco" | "peral";

const DENSIDAD = 1.6; // t/m³

const today   = () => format(new Date(), "yyyy-MM-dd");
const nowTime = () => format(new Date(), "HH:mm");
const fmt     = (v: number | null | undefined, dec = 0) =>
  v == null ? "—" : v.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pf = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const calcTon = (m3: string) => {
  const v = parseFloat(m3);
  return isNaN(v) ? "" : (v * DENSIDAD).toFixed(3);
};

// ---- KPI Card ----
function KpiCard({ label, m3, ton, highlight }: { label: string; m3?: number | null; ton?: number | null; highlight?: boolean }) {
  return (
    <div className={`card flex flex-col gap-1 min-w-[130px] ${highlight ? "border-green-300 bg-green-50" : ""}`}>
      <div className="stat-label">{label}</div>
      {ton != null && (
        <div className={`text-xl font-bold ${highlight ? "text-green-700" : "text-gray-900"}`}>
          {fmt(ton)} <span className="text-sm font-normal text-gray-400">ton</span>
        </div>
      )}
      {m3 != null && (
        <div className="text-xs text-gray-400">{fmt(m3)} m³</div>
      )}
    </div>
  );
}

function Pagination({ page, total, perPage, onChange }: { page: number; total: number; perPage: number; onChange: (p: number) => void }) {
  const pages = Math.ceil(total / perPage) || 1;
  return (
    <div className="flex items-center gap-2">
      <button disabled={page === 0} onClick={() => onChange(page - 1)}
        className="px-3 py-1 rounded border border-gray-200 text-sm text-gray-600 disabled:opacity-30 hover:bg-gray-50">←</button>
      <span className="text-sm text-gray-500">{page + 1} / {pages}</span>
      <button disabled={page >= pages - 1} onClick={() => onChange(page + 1)}
        className="px-3 py-1 rounded border border-gray-200 text-sm text-gray-600 disabled:opacity-30 hover:bg-gray-50">→</button>
    </div>
  );
}

// ---- Input m3 + ton calculado ----
function M3Field({ label, keyM3, keyTon, form, onChange }: {
  label: string; keyM3: string; keyTon: string;
  form: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
  const handleM3 = (v: string) => {
    onChange(keyM3, v);
    onChange(keyTon, calcTon(v));
  };
  return (
    <div className="col-span-1">
      <span className="label">{label}</span>
      <div className="flex gap-1 items-end">
        <div className="flex-1">
          <span className="text-[10px] text-gray-400 block mb-0.5">m³</span>
          <input type="number" step="0.001" className="input" placeholder="0"
            value={form[keyM3]} onChange={e => handleM3(e.target.value)} />
        </div>
        <div className="flex-1">
          <span className="text-[10px] text-gray-400 block mb-0.5">ton (×{DENSIDAD})</span>
          <input type="number" step="0.001" className="input bg-gray-50 text-gray-500" placeholder="auto"
            value={form[keyTon]} readOnly />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TURCO
// ============================================================
const defaultTurco = () => ({
  fecha: today(), hora: nowTime(),
  arena_mina_m3: "", arena_mina_ton: "",
  tlh_m3: "", tlh_ton: "",
  esteril_m3: "", esteril_ton: "",
  grancilla_m3: "", grancilla_ton: "",
  fierrillo_a_m3: "", fierrillo_a_ton: "",
  fierrillo_b_m3: "", fierrillo_b_ton: "",
  fierrillo_total_ton: "", notas: "",
});

function TurcoTab() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.rol === "admin";

  const [historial, setHistorial] = useState<RegistroTurco[]>([]);
  const [form, setForm]           = useState<Record<string, string>>(defaultTurco());
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [page, setPage]           = useState(0);
  const PER_PAGE = 10;

  useEffect(() => { loadHistorial(); }, []);

  // Auto-calcular fierrillo_total cuando cambian A o B
  useEffect(() => {
    const a = parseFloat(form.fierrillo_a_ton) || 0;
    const b = parseFloat(form.fierrillo_b_ton) || 0;
    if (form.fierrillo_a_ton || form.fierrillo_b_ton) {
      setForm(f => ({ ...f, fierrillo_total_ton: (a + b).toFixed(3) }));
    }
  }, [form.fierrillo_a_ton, form.fierrillo_b_ton]);

  async function loadHistorial() {
    const { data } = await supabase
      .from("registros_turco").select("*")
      .order("fecha_hora", { ascending: false }).limit(300);
    if (data) setHistorial(data as RegistroTurco[]);
  }

  const last = historial[0] ?? null;
  const set  = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true); setMsg(null);
    const { error } = await supabase.from("registros_turco").insert({
      fecha: form.fecha, hora: form.hora,
      arena_mina_m3: pf(form.arena_mina_m3), arena_mina_ton: pf(form.arena_mina_ton),
      tlh_m3: pf(form.tlh_m3), tlh_ton: pf(form.tlh_ton),
      esteril_m3: pf(form.esteril_m3), esteril_ton: pf(form.esteril_ton),
      grancilla_m3: pf(form.grancilla_m3), grancilla_ton: pf(form.grancilla_ton),
      fierrillo_a_m3: pf(form.fierrillo_a_m3), fierrillo_a_ton: pf(form.fierrillo_a_ton),
      fierrillo_b_m3: pf(form.fierrillo_b_m3), fierrillo_b_ton: pf(form.fierrillo_b_ton),
      fierrillo_total_ton: pf(form.fierrillo_total_ton),
      notas: form.notas || null,
    });
    if (error) { setMsg({ type: "err", text: "Error: " + error.message }); }
    else       { setMsg({ type: "ok",  text: "Registro guardado." }); setForm(defaultTurco()); loadHistorial(); }
    setSaving(false);
  }

  const paginated = historial.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  return (
    <div className="space-y-6">
      {last && (
        <div>
          <p className="text-xs text-gray-400 mb-3">Último droneo: <strong className="text-gray-600">{last.fecha}</strong> {last.hora?.slice(0,5)}</p>
          <div className="flex flex-wrap gap-3">
            <KpiCard label="Arena Mina"      m3={last.arena_mina_m3}   ton={last.arena_mina_ton} />
            <KpiCard label="TLH"             m3={last.tlh_m3}          ton={last.tlh_ton} />
            <KpiCard label="Estéril"         m3={last.esteril_m3}      ton={last.esteril_ton} />
            <KpiCard label="Grancilla"       m3={last.grancilla_m3}    ton={last.grancilla_ton} />
            <KpiCard label="Fierrillo A"     m3={last.fierrillo_a_m3}  ton={last.fierrillo_a_ton} />
            <KpiCard label="Fierrillo B"     m3={last.fierrillo_b_m3}  ton={last.fierrillo_b_ton} />
            <KpiCard label="Fierrillo Total" ton={last.fierrillo_total_ton} highlight />
          </div>
        </div>
      )}

      {isAdmin && (
        <AdminGuard>
          <div className="card space-y-4">
            <h3 className="font-semibold text-gray-700">Nuevo registro Turco</h3>
            <p className="text-xs text-gray-400">Toneladas calculadas automáticamente con densidad {DENSIDAD} t/m³</p>

            {/* Fecha y hora */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label>
                <span className="label">Fecha</span>
                <input type="date" className="input" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
              </label>
              <label>
                <span className="label">Hora</span>
                <input type="time" className="input" value={form.hora} onChange={e => set("hora", e.target.value)} />
              </label>
            </div>

            {/* Materiales: m3 → ton auto */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <M3Field label="Arena Mina"  keyM3="arena_mina_m3"  keyTon="arena_mina_ton"  form={form} onChange={set} />
              <M3Field label="TLH"         keyM3="tlh_m3"         keyTon="tlh_ton"         form={form} onChange={set} />
              <M3Field label="Estéril"     keyM3="esteril_m3"     keyTon="esteril_ton"     form={form} onChange={set} />
              <M3Field label="Grancilla"   keyM3="grancilla_m3"   keyTon="grancilla_ton"   form={form} onChange={set} />
              <M3Field label="Fierrillo A" keyM3="fierrillo_a_m3" keyTon="fierrillo_a_ton" form={form} onChange={set} />
              <M3Field label="Fierrillo B" keyM3="fierrillo_b_m3" keyTon="fierrillo_b_ton" form={form} onChange={set} />
            </div>

            {/* Fierrillo Total — suma automática */}
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <span className="label text-green-700 mb-0">Fierrillo Total ton</span>
              <span className="text-lg font-bold text-green-700">
                {form.fierrillo_total_ton ? parseFloat(form.fierrillo_total_ton).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"} ton
              </span>
              <span className="text-xs text-gray-400">(Fierrillo A + B)</span>
            </div>

            <label>
              <span className="label">Notas</span>
              <input type="text" className="input" value={form.notas} onChange={e => set("notas", e.target.value)} />
            </label>

            {msg && (
              <p className={`text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>
            )}
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? "Guardando…" : "Guardar registro"}
            </button>
          </div>
        </AdminGuard>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="font-semibold text-gray-700 text-sm">Historial ({historial.length} registros)</span>
          <Pagination page={page} total={historial.length} perPage={PER_PAGE} onChange={setPage} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th text-left">Fecha</th>
                <th className="table-th text-left">Hora</th>
                <th className="table-th">Arena Mina m³</th><th className="table-th">Arena Mina ton</th>
                <th className="table-th">TLH m³</th><th className="table-th">TLH ton</th>
                <th className="table-th">Estéril m³</th><th className="table-th">Estéril ton</th>
                <th className="table-th">Grancilla m³</th><th className="table-th">Grancilla ton</th>
                <th className="table-th">Fierr. A ton</th><th className="table-th">Fierr. B ton</th>
                <th className="table-th">Fierr. Total ton</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginated.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                  <td className="table-td-left font-medium text-gray-800">{r.fecha}</td>
                  <td className="table-td-left text-gray-500">{r.hora?.slice(0,5)}</td>
                  <td className="table-td">{fmt(r.arena_mina_m3)}</td>
                  <td className="table-td font-medium">{fmt(r.arena_mina_ton)}</td>
                  <td className="table-td">{fmt(r.tlh_m3)}</td>
                  <td className="table-td">{fmt(r.tlh_ton)}</td>
                  <td className="table-td">{fmt(r.esteril_m3)}</td>
                  <td className="table-td">{fmt(r.esteril_ton)}</td>
                  <td className="table-td">{fmt(r.grancilla_m3)}</td>
                  <td className="table-td">{fmt(r.grancilla_ton)}</td>
                  <td className="table-td">{fmt(r.fierrillo_a_ton)}</td>
                  <td className="table-td">{fmt(r.fierrillo_b_ton)}</td>
                  <td className="table-td font-semibold text-green-700">{fmt(r.fierrillo_total_ton)}</td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr><td colSpan={13} className="text-center text-gray-400 py-8 text-sm">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PERAL
// ============================================================
const defaultPeral = () => ({
  fecha: today(), hora: nowTime(),
  arena_mina_m3: "", arena_mina_ton: "",
  a22_m3: "", a22_ton: "", a24_m3: "", a24_ton: "",
  a25_m3: "", a25_ton: "", a26_m3: "", a26_ton: "",
  dmh_m3: "", dmh_ton: "",
  grancilla_m3: "", grancilla_ton: "",
  stock_arena_humeda_ton: "", notas: "",
});

function PeralTab() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.rol === "admin";

  const [historial, setHistorial] = useState<RegistroPeral[]>([]);
  const [form, setForm]           = useState<Record<string, string>>(defaultPeral());
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [page, setPage]           = useState(0);
  const PER_PAGE = 10;

  useEffect(() => { loadHistorial(); }, []);

  // Auto-calcular Arena Húmeda = A-24 + A-25 + A-26 (A-22 y Grancilla son independientes)
  useEffect(() => {
    const vals = ["a24_ton","a25_ton","a26_ton"];
    const total = vals.reduce((s, k) => s + (parseFloat(form[k]) || 0), 0);
    if (vals.some(k => form[k])) {
      setForm(f => ({ ...f, stock_arena_humeda_ton: total.toFixed(3) }));
    }
  }, [form.a24_ton, form.a25_ton, form.a26_ton]);

  async function loadHistorial() {
    const { data } = await supabase
      .from("registros_peral").select("*")
      .order("fecha_hora", { ascending: false }).limit(300);
    if (data) setHistorial(data as RegistroPeral[]);
  }

  const last = historial[0] ?? null;
  const set  = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true); setMsg(null);
    const { error } = await supabase.from("registros_peral").insert({
      fecha: form.fecha, hora: form.hora,
      arena_mina_m3: pf(form.arena_mina_m3), arena_mina_ton: pf(form.arena_mina_ton),
      a22_m3: pf(form.a22_m3), a22_ton: pf(form.a22_ton),
      a24_m3: pf(form.a24_m3), a24_ton: pf(form.a24_ton),
      a25_m3: pf(form.a25_m3), a25_ton: pf(form.a25_ton),
      a26_m3: pf(form.a26_m3), a26_ton: pf(form.a26_ton),
      dmh_m3: pf(form.dmh_m3), dmh_ton: pf(form.dmh_ton),
      grancilla_m3: pf(form.grancilla_m3), grancilla_ton: pf(form.grancilla_ton),
      stock_arena_humeda_ton: pf(form.stock_arena_humeda_ton),
      notas: form.notas || null,
    });
    if (error) { setMsg({ type: "err", text: "Error: " + error.message }); }
    else       { setMsg({ type: "ok",  text: "Registro guardado." }); setForm(defaultPeral()); loadHistorial(); }
    setSaving(false);
  }

  const paginated = historial.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  return (
    <div className="space-y-6">
      {last && (
        <div>
          <p className="text-xs text-gray-400 mb-3">Último droneo: <strong className="text-gray-600">{last.fecha}</strong> {last.hora?.slice(0,5)}</p>
          <div className="flex flex-wrap gap-3">
            <KpiCard label="Arena Mina"         m3={last.arena_mina_m3} ton={last.arena_mina_ton} />
            <KpiCard label="A-22"               m3={last.a22_m3}        ton={last.a22_ton} />
            <KpiCard label="A-24"               m3={last.a24_m3}        ton={last.a24_ton} />
            <KpiCard label="A-25"               m3={last.a25_m3}        ton={last.a25_ton} />
            <KpiCard label="A-26"               m3={last.a26_m3}        ton={last.a26_ton} />
            <KpiCard label="DMH"                m3={last.dmh_m3}        ton={last.dmh_ton} />
            <KpiCard label="Grancilla"          m3={last.grancilla_m3}  ton={last.grancilla_ton} />
            <KpiCard label="Arena Húmeda (A24+A25+A26)" ton={last.stock_arena_humeda_ton} highlight />
          </div>
        </div>
      )}

      {isAdmin && (
        <AdminGuard>
          <div className="card space-y-4">
            <h3 className="font-semibold text-gray-700">Nuevo registro Peral</h3>
            <p className="text-xs text-gray-400">Toneladas calculadas automáticamente con densidad {DENSIDAD} t/m³</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label>
                <span className="label">Fecha</span>
                <input type="date" className="input" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
              </label>
              <label>
                <span className="label">Hora</span>
                <input type="time" className="input" value={form.hora} onChange={e => set("hora", e.target.value)} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <M3Field label="Arena Mina" keyM3="arena_mina_m3" keyTon="arena_mina_ton" form={form} onChange={set} />
              <M3Field label="A-22"       keyM3="a22_m3"        keyTon="a22_ton"        form={form} onChange={set} />
              <M3Field label="A-24"       keyM3="a24_m3"        keyTon="a24_ton"        form={form} onChange={set} />
              <M3Field label="A-25"       keyM3="a25_m3"        keyTon="a25_ton"        form={form} onChange={set} />
              <M3Field label="A-26"       keyM3="a26_m3"        keyTon="a26_ton"        form={form} onChange={set} />
              <M3Field label="DMH"        keyM3="dmh_m3"        keyTon="dmh_ton"        form={form} onChange={set} />
              <M3Field label="Grancilla"  keyM3="grancilla_m3"  keyTon="grancilla_ton"  form={form} onChange={set} />
            </div>

            {/* Stock total — suma automática */}
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <span className="label text-green-700 mb-0">Stock Arena Húmeda</span>
              <span className="text-lg font-bold text-green-700">
                {form.stock_arena_humeda_ton ? parseFloat(form.stock_arena_humeda_ton).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"} ton
              </span>
              <span className="text-xs text-gray-400">(A22 + A24 + A25 + A26 + DMH + Grancilla)</span>
            </div>

            <label>
              <span className="label">Notas</span>
              <input type="text" className="input" value={form.notas} onChange={e => set("notas", e.target.value)} />
            </label>

            {msg && (
              <p className={`text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>
            )}
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? "Guardando…" : "Guardar registro"}
            </button>
          </div>
        </AdminGuard>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="font-semibold text-gray-700 text-sm">Historial ({historial.length} registros)</span>
          <Pagination page={page} total={historial.length} perPage={PER_PAGE} onChange={setPage} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th text-left">Fecha</th>
                <th className="table-th text-left">Hora</th>
                <th className="table-th">Arena Mina m³</th><th className="table-th">Arena Mina ton</th>
                <th className="table-th">A-22 ton</th><th className="table-th">A-24 ton</th>
                <th className="table-th">A-25 ton</th><th className="table-th">A-26 ton</th>
                <th className="table-th">DMH ton</th><th className="table-th">Grancilla ton</th>
                <th className="table-th">Stock Arena Húmeda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginated.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                  <td className="table-td-left font-medium text-gray-800">{r.fecha}</td>
                  <td className="table-td-left text-gray-500">{r.hora?.slice(0,5)}</td>
                  <td className="table-td">{fmt(r.arena_mina_m3)}</td>
                  <td className="table-td font-medium">{fmt(r.arena_mina_ton)}</td>
                  <td className="table-td">{fmt(r.a22_ton)}</td>
                  <td className="table-td">{fmt(r.a24_ton)}</td>
                  <td className="table-td">{fmt(r.a25_ton)}</td>
                  <td className="table-td">{fmt(r.a26_ton)}</td>
                  <td className="table-td">{fmt(r.dmh_ton)}</td>
                  <td className="table-td">{fmt(r.grancilla_ton)}</td>
                  <td className="table-td font-semibold text-green-700">{fmt(r.stock_arena_humeda_ton)}</td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr><td colSpan={11} className="text-center text-gray-400 py-8 text-sm">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================
export default function CentroPage() {
  const [tab, setTab] = useState<Tab>("turco");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Zona Centro</h1>
        <p className="text-sm text-gray-500 mt-1">Cubicaciones históricas — Turco y Peral</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(["turco","peral"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
              tab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
            }`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "turco" ? <TurcoTab /> : <PeralTab />}
    </div>
  );
}
