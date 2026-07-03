/**
 * generarImagenEmail — genera un PNG vertical (560x720 px) del informe
 * usando next/og (ImageResponse + Satori, ya incluidos en Next.js 14).
 * Se embebe en el correo como imagen CID inline.
 */

import { ImageResponse } from "next/og";

export interface EmailCardData {
  fecha:                   string;
  hora:                    string;
  productividad_drone:     number;
  produccion_drone:        number;
  inventario_ton:          number;
  despachos_ton:           number;
  cantidad_despachos:      number;
  horas_reales:            number;
  detencion:               number;
  inventario_cuarzo?:      number | null;
  usuario_email?:          string;
  isReenvio?:              boolean;
}

const W = 560;
const H = 700;

function fmt(v: number, dec = 1) {
  return isFinite(v)
    ? v.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec })
    : "-";
}
function fmtInt(v: number) {
  return isFinite(v) ? Math.round(v).toLocaleString("es-CL") : "-";
}

export async function generarImagenEmail(d: EmailCardData): Promise<Buffer> {
  const fechaFmt = d.fecha.split("-").reverse().join("/");
  const kpiColor  = d.productividad_drone >= 32 ? "#16a34a" : "#dc2626";
  const invColor  = d.inventario_ton >= 7500 ? "#16a34a" : d.inventario_ton >= 6500 ? "#d97706" : "#dc2626";
  const detColor  = d.detencion > 0 ? "#dc2626" : "#16a34a";
  const totalHrs  = d.horas_reales + d.detencion;
  const detPct    = totalHrs > 0 ? ((d.detencion / totalHrs) * 100).toFixed(0) + "%" : "-";

  interface RowProps { label: string; value: string; color?: string; last?: boolean; muted?: boolean }
  function DataRow({ label, value, color = "#1e293b", last = false, muted = false }: RowProps) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 0",
          borderBottom: last ? "none" : "1px solid #e2e8f0",
          opacity: muted ? 0.7 : 1,
        }}
      >
        <span style={{ fontSize: 13, color: "#64748b", fontFamily: "Arial, sans-serif" }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: "bold", color, fontFamily: "Arial, sans-serif" }}>{value}</span>
      </div>
    );
  }

  const badge   = d.isReenvio ? "REENVIO - PLANTA LAS PIEDRAS" : "PLANTA LAS PIEDRAS";
  const dateStr = fechaFmt + "  -  " + d.hora;
  const hasCuarzo = d.inventario_cuarzo != null && isFinite(d.inventario_cuarzo);

  const element = (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        backgroundColor: "#f8fafc",
      }}
    >
      <div
        style={{
          backgroundColor: "#374151",
          padding: "22px 28px 18px",
          borderLeft: "7px solid #6BCF7F",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 10, color: "#6BCF7F", fontWeight: "bold", letterSpacing: 2, marginBottom: 7, fontFamily: "Arial, sans-serif" }}>
          {badge}
        </div>
        <div style={{ fontSize: 20, color: "#ffffff", fontWeight: "bold", marginBottom: 4, fontFamily: "Arial, sans-serif" }}>
          Informe de Cubicacion Arena
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: "Arial, sans-serif" }}>
          {dateStr}
        </div>
      </div>

      <div
        style={{
          backgroundColor: "#1e293b",
          padding: "18px 28px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 4, fontFamily: "Arial, sans-serif" }}>
            PRODUCTIVIDAD DRONE
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 46, fontWeight: "bold", color: kpiColor, lineHeight: 1, fontFamily: "Arial, sans-serif" }}>
              {fmt(d.productividad_drone)}
            </span>
            <span style={{ fontSize: 16, color: "#64748b", fontFamily: "Arial, sans-serif" }}>t/h</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 4, fontFamily: "Arial, sans-serif" }}>
            PRODUCCION
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 32, fontWeight: "bold", color: "#e2e8f0", lineHeight: 1, fontFamily: "Arial, sans-serif" }}>
              {fmtInt(d.produccion_drone)}
            </span>
            <span style={{ fontSize: 14, color: "#64748b", fontFamily: "Arial, sans-serif" }}>ton</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 28px 8px", display: "flex", flexDirection: "column", flexGrow: 1 }}>
        <DataRow label="Inventario Arena" value={fmtInt(d.inventario_ton) + " ton"} color={invColor} />
        {hasCuarzo && (
          <DataRow label="Inventario Cuarzo" value={fmtInt(d.inventario_cuarzo!) + " ton"} color="#374151" />
        )}
        <DataRow label="Despachos" value={fmtInt(d.despachos_ton) + " ton - " + d.cantidad_despachos + " viajes"} />
        <DataRow label="Horas produccion" value={fmt(d.horas_reales) + " hrs"} />
        <DataRow label="Detencion" value={fmt(d.detencion) + " hrs (" + detPct + ")"} color={detColor} last />
      </div>

      <div style={{ height: 3, backgroundColor: "#6BCF7F", marginLeft: 28, marginRight: 28 }} />

      <div
        style={{
          padding: "10px 28px",
          backgroundColor: "#f1f5f9",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "Arial, sans-serif" }}>
          generado automaticamente - arena-control
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "Arial, sans-serif" }}>
          {d.usuario_email ?? "sistema"}
        </div>
      </div>
    </div>
  );

  const imageResponse = new ImageResponse(element, { width: W, height: H });
  const ab = await imageResponse.arrayBuffer();
  return Buffer.from(ab);
}
