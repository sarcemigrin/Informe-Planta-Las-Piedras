"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import type { RegistroTurco, RegistroPeral } from "@/types/database";

type Tab = "turco" | "peral";

const today   = () => format(new Date(), "yyyy-MM-dd");
const nowTime = () => format(new Date(), "HH:mm");

const fmt = (v: number | null | undefined, dec = 1) =>
  v == null ? "—" : v.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ---- Formularios vacíos ----
const defaultTurco = () => ({
  fecha: today(), hora: nowTime(),
  arena_mina_m3: "", arena_mina_ton: "",
  tlh_m3: "", tlh_ton: "",
  esteril_m3: "", esteril_ton: "",
  grancilla_m3: "", grancilla_ton: "",
  fierrillo_a_m3: "", fierrillo_a_ton: "",
  fierrillo_b_m3: "", fierrillo_b_ton: "",
  fierrillo_total_ton: "",
  notas: "",
});

const defaultPeral = () => ({
  fecha: today(), hora: nowTime(),
  arena_mina_m3: "", arena_mina_ton: "",
  a22_m3: "", a22_ton: "",
  a24_m3: "", a24_ton: "",
  a25_m3: "", a25_ton: "",
  a26_m3: "", a26_ton: "",
  dmh_m3: "", dmh_ton: "",
  grancilla_m3: "", grancilla_ton: "",
  stock_arena_humeda_ton: "",
  notas: "",
});

const pf = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

// ---- KPI Card ----
function KpiCard({ label, m3, ton, highlight }: { label: string; m3?: number | null; ton?: number | null; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.04)",
      border: `1px solid ${highlight ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.08)"}`,
      borderRadius: 12, padding: "14px 16px", minWidth: 130,
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      {ton != null && (
        <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? "#60a5fa" : "#fff", lineHeight: 1.1 }}>
          {fmt(ton, 0)} <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>ton</span>
        </div>
      )}
      {m3 != null && (
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{fmt(m3, 0)} m³</div>
      )}
    </div>
  );
}

// ---- Tabla historial común ----
function TableCell({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td style={{
      padding: "8px 12px", fontSize: 13, color: "rgba(255,255,255,0.85)",
      borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: right ? "right" : "left",
      whiteSpace: "nowrap",
    }}>{children}</td>
  );
}

function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.45)",
      textTransform: "uppercase", letterSpacing: "0.05em", textAlign: right ? "right" : "left",
      borderBottom: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap",
    }}>{children}</th>
  );
}

// ============================================================
// TURCO
// ============================================================
function TurcoTab({ isAdmin }: { isAdmin: boolean }) {
  const [historial, setHistorial] = useState<RegistroTurco[]>([]);
  const [form, setForm]           = useState<Record<string, string>>(defaultTurco());
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [page, setPage]           = useState(0);
  const PER_PAGE = 10;

  useEffect(() => { loadHistorial(); }, []);

  async function loadHistorial() {
    const { data } = await supabase
      .from("registros_turco")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(200);
    if (data) setHistorial(data as RegistroTurco[]);
  }

  const last = historial[0] ?? null;

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true); setMsg(null);
    const row: Omit<RegistroTurco, "id" | "created_at" | "updated_at" | "fecha_hora"> = {
      fecha: form.fecha, hora: form.hora,
      arena_mina_m3:  pf(form.arena_mina_m3),  arena_mina_ton:  pf(form.arena_mina_ton),
      tlh_m3:         pf(form.tlh_m3),          tlh_ton:         pf(form.tlh_ton),
      esteril_m3:     pf(form.esteril_m3),       esteril_ton:     pf(form.esteril_ton),
      grancilla_m3:   pf(form.grancilla_m3),     grancilla_ton:   pf(form.grancilla_ton),
      fierrillo_a_m3: pf(form.fierrillo_a_m3),  fierrillo_a_ton: pf(form.fierrillo_a_ton),
      fierrillo_b_m3: pf(form.fierrillo_b_m3),  fierrillo_b_ton: pf(form.fierrillo_b_ton),
      fierrillo_total_ton: pf(form.fierrillo_total_ton),
      notas: form.notas || null,
    };
    const { error } = await supabase.from("registros_turco").insert(row);
    if (error) {
      setMsg({ type: "err", text: "Error al guardar: " + error.message });
    } else {
      setMsg({ type: "ok", text: "Registro guardado correctamente." });
      setForm(defaultTurco());
      loadHistorial();
    }
    setSaving(false);
  }

  const paginated = historial.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(historial.length / PER_PAGE);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ---- KPIs último registro ---- */}
      {last && (
        <div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
            Último droneo: {last.fecha} {last.hora?.slice(0,5)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <KpiCard label="Arena Mina"   m3={last.arena_mina_m3}   ton={last.arena_mina_ton} />
            <KpiCard label="TLH"          m3={last.tlh_m3}          ton={last.tlh_ton} />
            <KpiCard label="Estéril"      m3={last.esteril_m3}      ton={last.esteril_ton} />
            <KpiCard label="Grancilla"    m3={last.grancilla_m3}    ton={last.grancilla_ton} />
            <KpiCard label="Fierrillo A"  m3={last.fierrillo_a_m3}  ton={last.fierrillo_a_ton} />
            <KpiCard label="Fierrillo B"  m3={last.fierrillo_b_m3}  ton={last.fierrillo_b_ton} />
            <KpiCard label="Fierrillo Total" ton={last.fierrillo_total_ton} highlight />
          </div>
        </div>
      )}

      {/* ---- Formulario nuevo registro ---- */}
      {isAdmin && (
        <AdminGuard>
          <div style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: 24,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 20 }}>Nuevo registro Turco</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
              {[
                { k: "fecha",       label: "Fecha",      type: "date" },
                { k: "hora",        label: "Hora",       type: "time" },
              ].map(({ k, label, type }) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{label}</span>
                  <input type={type} value={form[k]} onChange={e => set(k, e.target.value)}
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }} />
                </label>
              ))}
              {[
                ["Arena Mina m³", "arena_mina_m3"],   ["Arena Mina ton", "arena_mina_ton"],
                ["TLH m³",        "tlh_m3"],           ["TLH ton",        "tlh_ton"],
                ["Estéril m³",    "esteril_m3"],       ["Estéril ton",    "esteril_ton"],
                ["Grancilla m³",  "grancilla_m3"],     ["Grancilla ton",  "grancilla_ton"],
                ["Fierrillo A m³","fierrillo_a_m3"],   ["Fierrillo A ton","fierrillo_a_ton"],
                ["Fierrillo B m³","fierrillo_b_m3"],   ["Fierrillo B ton","fierrillo_b_ton"],
                ["Fierrillo Total ton","fierrillo_total_ton"],
              ].map(([label, k]) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{label}</span>
                  <input type="number" step="0.001" value={form[k]} onChange={e => set(k, e.target.value)}
                    placeholder="0"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }} />
                </label>
              ))}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Notas</span>
                <input type="text" value={form.notas} onChange={e => set("notas", e.target.value)}
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }} />
              </label>
            </div>
            {msg && (
              <div style={{
                marginTop: 14, padding: "10px 14px", borderRadius: 8, fontSize: 13,
                background: msg.type === "ok" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                color: msg.type === "ok" ? "#4ade80" : "#f87171",
                border: `1px solid ${msg.type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
              }}>{msg.text}</div>
            )}
            <button onClick={handleSave} disabled={saving}
              style={{
                marginTop: 16, padding: "10px 24px", borderRadius: 10, border: "none", cursor: "pointer",
                background: saving ? "rgba(59,130,246,0.4)" : "#3b82f6", color: "#fff",
                fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1,
              }}>
              {saving ? "Guardando…" : "Guardar registro"}
            </button>
          </div>
        </AdminGuard>
      )}

      {/* ---- Historial ---- */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Historial ({historial.length} registros)</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", cursor: page > 0 ? "pointer" : "not-allowed", opacity: page === 0 ? 0.4 : 1 }}>←</button>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: "28px" }}>{page + 1}/{totalPages || 1}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", cursor: page < totalPages - 1 ? "pointer" : "not-allowed", opacity: page >= totalPages - 1 ? 0.4 : 1 }}>→</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <TH>Fecha</TH><TH>Hora</TH>
                <TH right>Arena Mina m³</TH><TH right>Arena Mina ton</TH>
                <TH right>TLH m³</TH><TH right>TLH ton</TH>
                <TH right>Estéril m³</TH><TH right>Estéril ton</TH>
                <TH right>Grancilla m³</TH><TH right>Grancilla ton</TH>
                <TH right>Fierr. A ton</TH><TH right>Fierr. B ton</TH>
                <TH right>Fierr. Total ton</TH>
              </tr>
            </thead>
            <tbody>
              {paginated.map(r => (
                <tr key={r.id} style={{ background: "transparent" }}>
                  <TableCell>{r.fecha}</TableCell>
                  <TableCell>{r.hora?.slice(0,5)}</TableCell>
                  <TableCell right>{fmt(r.arena_mina_m3, 0)}</TableCell>
                  <TableCell right>{fmt(r.arena_mina_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.tlh_m3, 0)}</TableCell>
                  <TableCell right>{fmt(r.tlh_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.esteril_m3, 0)}</TableCell>
                  <TableCell right>{fmt(r.esteril_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.grancilla_m3, 0)}</TableCell>
                  <TableCell right>{fmt(r.grancilla_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.fierrillo_a_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.fierrillo_b_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.fierrillo_total_ton, 0)}</TableCell>
                </tr>
              ))}
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
function PeralTab({ isAdmin }: { isAdmin: boolean }) {
  const [historial, setHistorial] = useState<RegistroPeral[]>([]);
  const [form, setForm]           = useState<Record<string, string>>(defaultPeral());
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [page, setPage]           = useState(0);
  const PER_PAGE = 10;

  useEffect(() => { loadHistorial(); }, []);

  async function loadHistorial() {
    const { data } = await supabase
      .from("registros_peral")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(200);
    if (data) setHistorial(data as RegistroPeral[]);
  }

  const last = historial[0] ?? null;
  const set  = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true); setMsg(null);
    const row: Omit<RegistroPeral, "id" | "created_at" | "updated_at" | "fecha_hora"> = {
      fecha: form.fecha, hora: form.hora,
      arena_mina_m3:        pf(form.arena_mina_m3),   arena_mina_ton:        pf(form.arena_mina_ton),
      a22_m3:               pf(form.a22_m3),           a22_ton:               pf(form.a22_ton),
      a24_m3:               pf(form.a24_m3),           a24_ton:               pf(form.a24_ton),
      a25_m3:               pf(form.a25_m3),           a25_ton:               pf(form.a25_ton),
      a26_m3:               pf(form.a26_m3),           a26_ton:               pf(form.a26_ton),
      dmh_m3:               pf(form.dmh_m3),           dmh_ton:               pf(form.dmh_ton),
      grancilla_m3:         pf(form.grancilla_m3),     grancilla_ton:         pf(form.grancilla_ton),
      stock_arena_humeda_ton: pf(form.stock_arena_humeda_ton),
      notas: form.notas || null,
    };
    const { error } = await supabase.from("registros_peral").insert(row);
    if (error) {
      setMsg({ type: "err", text: "Error al guardar: " + error.message });
    } else {
      setMsg({ type: "ok", text: "Registro guardado correctamente." });
      setForm(defaultPeral());
      loadHistorial();
    }
    setSaving(false);
  }

  const paginated  = historial.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(historial.length / PER_PAGE);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ---- KPIs último registro ---- */}
      {last && (
        <div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
            Último droneo: {last.fecha} {last.hora?.slice(0,5)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <KpiCard label="Arena Mina"        m3={last.arena_mina_m3}        ton={last.arena_mina_ton} />
            <KpiCard label="A-22"              m3={last.a22_m3}               ton={last.a22_ton} />
            <KpiCard label="A-24"              m3={last.a24_m3}               ton={last.a24_ton} />
            <KpiCard label="A-25"              m3={last.a25_m3}               ton={last.a25_ton} />
            <KpiCard label="A-26"              m3={last.a26_m3}               ton={last.a26_ton} />
            <KpiCard label="DMH"               m3={last.dmh_m3}               ton={last.dmh_ton} />
            <KpiCard label="Grancilla"         m3={last.grancilla_m3}         ton={last.grancilla_ton} />
            <KpiCard label="Stock Arena Húmeda" ton={last.stock_arena_humeda_ton} highlight />
          </div>
        </div>
      )}

      {/* ---- Formulario nuevo registro ---- */}
      {isAdmin && (
        <AdminGuard>
          <div style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: 24,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 20 }}>Nuevo registro Peral</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
              {[
                { k: "fecha", label: "Fecha", type: "date" },
                { k: "hora",  label: "Hora",  type: "time" },
              ].map(({ k, label, type }) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{label}</span>
                  <input type={type} value={form[k]} onChange={e => set(k, e.target.value)}
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }} />
                </label>
              ))}
              {[
                ["Arena Mina m³", "arena_mina_m3"], ["Arena Mina ton", "arena_mina_ton"],
                ["A-22 m³",       "a22_m3"],        ["A-22 ton",       "a22_ton"],
                ["A-24 m³",       "a24_m3"],        ["A-24 ton",       "a24_ton"],
                ["A-25 m³",       "a25_m3"],        ["A-25 ton",       "a25_ton"],
                ["A-26 m³",       "a26_m3"],        ["A-26 ton",       "a26_ton"],
                ["DMH m³",        "dmh_m3"],         ["DMH ton",        "dmh_ton"],
                ["Grancilla m³",  "grancilla_m3"],  ["Grancilla ton",  "grancilla_ton"],
                ["Stock Arena Húmeda ton", "stock_arena_humeda_ton"],
              ].map(([label, k]) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{label}</span>
                  <input type="number" step="0.001" value={form[k]} onChange={e => set(k, e.target.value)}
                    placeholder="0"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }} />
                </label>
              ))}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Notas</span>
                <input type="text" value={form.notas} onChange={e => set("notas", e.target.value)}
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }} />
              </label>
            </div>
            {msg && (
              <div style={{
                marginTop: 14, padding: "10px 14px", borderRadius: 8, fontSize: 13,
                background: msg.type === "ok" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                color: msg.type === "ok" ? "#4ade80" : "#f87171",
                border: `1px solid ${msg.type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
              }}>{msg.text}</div>
            )}
            <button onClick={handleSave} disabled={saving}
              style={{
                marginTop: 16, padding: "10px 24px", borderRadius: 10, border: "none", cursor: "pointer",
                background: saving ? "rgba(59,130,246,0.4)" : "#3b82f6", color: "#fff",
                fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1,
              }}>
              {saving ? "Guardando…" : "Guardar registro"}
            </button>
          </div>
        </AdminGuard>
      )}

      {/* ---- Historial ---- */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Historial ({historial.length} registros)</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", cursor: page > 0 ? "pointer" : "not-allowed", opacity: page === 0 ? 0.4 : 1 }}>←</button>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: "28px" }}>{page + 1}/{totalPages || 1}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", cursor: page < totalPages - 1 ? "pointer" : "not-allowed", opacity: page >= totalPages - 1 ? 0.4 : 1 }}>→</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <TH>Fecha</TH><TH>Hora</TH>
                <TH right>Arena Mina m³</TH><TH right>Arena Mina ton</TH>
                <TH right>A-22 ton</TH><TH right>A-24 ton</TH>
                <TH right>A-25 ton</TH><TH right>A-26 ton</TH>
                <TH right>DMH ton</TH><TH right>Grancilla ton</TH>
                <TH right>Stock Arena Húmeda</TH>
              </tr>
            </thead>
            <tbody>
              {paginated.map(r => (
                <tr key={r.id}>
                  <TableCell>{r.fecha}</TableCell>
                  <TableCell>{r.hora?.slice(0,5)}</TableCell>
                  <TableCell right>{fmt(r.arena_mina_m3, 0)}</TableCell>
                  <TableCell right>{fmt(r.arena_mina_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.a22_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.a24_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.a25_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.a26_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.dmh_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.grancilla_ton, 0)}</TableCell>
                  <TableCell right>{fmt(r.stock_arena_humeda_ton, 0)}</TableCell>
                </tr>
              ))}
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

  // Detectar si es admin (usando session de supabase)
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const role = data.session?.user?.app_metadata?.role ?? "";
      setIsAdmin(role === "admin" || role === "service_role");
    });
  }, []);

  const TABS: { id: Tab; label: string }[] = [
    { id: "turco", label: "Turco" },
    { id: "peral", label: "Peral" },
  ];

  return (
    <div style={{ minHeight: "100vh", padding: "24px 20px", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "#fff", margin: 0 }}>Zona Centro</h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
          Cubicaciones históricas y actuales — Turco y Peral
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 28, background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 4, width: "fit-content" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "8px 24px", borderRadius: 10, border: "none", cursor: "pointer",
              background: tab === t.id ? "rgba(255,255,255,0.12)" : "transparent",
              color: tab === t.id ? "#fff" : "rgba(255,255,255,0.45)",
              fontWeight: tab === t.id ? 600 : 400, fontSize: 14, transition: "all 0.15s",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {tab === "turco" ? <TurcoTab isAdmin={isAdmin} /> : <PeralTab isAdmin={isAdmin} />}
    </div>
  );
}
