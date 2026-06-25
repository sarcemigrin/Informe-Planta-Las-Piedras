/**
 * informe-pdf.ts
 * Genera PDF de informe de cubicación — pdf-lib (sin canvas, serverless-safe).
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export interface RegistroResumen {
  fecha:                   string;
  hora:                    string;
  produccion_drone:        number;
  productividad_drone:     number;
  productividad_pesometro: number;
  horas_reales:            number;
  detencion:               number;
  despachos_ton:           number;
  inventario_ton:          number;
}

export interface InformeData {
  fecha:                   string;
  hora:                    string;
  produccion_drone:        number;
  productividad_drone:     number;
  productividad_pesometro: number;
  diferencia_pesometro:    number;
  horas_reales:            number;
  detencion:               number;
  despachos_ton:           number;
  cantidad_despachos:      number;
  inventario_ton:          number;
  usuario_email?:          string;
  historial?:              RegistroResumen[];   // últimos registros para tabla
}

// ── Colores ──────────────────────────────────────────────────────────────────
const DARK   = rgb(0.216, 0.255, 0.318);
const GREEN  = rgb(0.420, 0.812, 0.498);
const LIGHT  = rgb(0.965, 0.973, 0.984);
const GRAY   = rgb(0.557, 0.604, 0.655);
const WHITE  = rgb(1, 1, 1);
const RED    = rgb(0.937, 0.267, 0.267);
const AMBER  = rgb(0.970, 0.650, 0.200);
const STRIPE = rgb(0.976, 0.980, 0.988);

function fmtN(n: number, dec = 1): string {
  if (!isFinite(n) || isNaN(n) || n === 0) return dec === 0 ? "0" : "0.0";
  return n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function drawRect(
  page: PDFPage, x: number, y: number, w: number, h: number,
  fill: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>,
) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill,
    ...(border ? { borderColor: border, borderWidth: 0.5 } : {}) });
}

function txt(
  page: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, color: ReturnType<typeof rgb>,
) {
  page.drawText(String(text), { x, y, font, size, color });
}

function kpiCard(
  page: PDFPage, fontR: PDFFont, fontB: PDFFont,
  x: number, y: number, w: number, h: number,
  label: string, value: string, unit: string,
  accent: ReturnType<typeof rgb>,
) {
  const border = rgb(0.882, 0.902, 0.925);
  drawRect(page, x, y, w, h, LIGHT, border);
  drawRect(page, x, y, 3, h, accent);
  txt(page, label.toUpperCase(), x + 9, y + h - 16, fontR, 6.5, GRAY);
  txt(page, value, x + 9, y + h / 2 - 5, fontB, 17, DARK);
  if (unit) {
    const vw = fontB.widthOfTextAtSize(value, 17);
    txt(page, unit, x + 9 + vw + 3, y + h / 2 - 3, fontR, 8, GRAY);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
export async function generarInformePDF(data: InformeData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([595, 842]);
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595;
  const M = 28;  // margin
  const usable = W - 2 * M;

  // ── HEADER ──────────────────────────────────────────────────────────────
  drawRect(page, 0, 792, W, 50, DARK);
  drawRect(page, 0, 792, 5, 50, GREEN);
  txt(page, "MIGRIN", M + 2, 826, fontB, 16, WHITE);
  txt(page, "Informe de Cubicación Arena  ·  Planta Las Piedras", M + 2, 810, fontR, 9, rgb(0.70, 0.75, 0.80));

  const fechaFmt = data.fecha.split("-").reverse().join("/");
  const dLabel   = `${fechaFmt}   ${data.hora}`;
  const dw       = fontB.widthOfTextAtSize(dLabel, 11);
  txt(page, dLabel, W - M - dw, 824, fontB, 11, WHITE);
  const uw = fontR.widthOfTextAtSize(data.usuario_email ?? "", 8);
  txt(page, data.usuario_email ?? "", W - M - uw, 810, fontR, 8, rgb(0.60, 0.65, 0.72));

  // ── INFO STRIP ──────────────────────────────────────────────────────────
  drawRect(page, 0, 778, W, 14, rgb(0.243, 0.282, 0.349));
  txt(page, "Generado automáticamente al guardar registro de droneo", M, 783, fontR, 7.5, rgb(0.65, 0.70, 0.76));
  const conf = "CONFIDENCIAL";
  txt(page, conf, W - M - fontR.widthOfTextAtSize(conf, 7.5), 783, fontR, 7.5, rgb(0.65, 0.70, 0.76));

  // ── SECCIÓN: KPIs del registro ───────────────────────────────────────────
  txt(page, "▌ INDICADORES DEL DRONEO", M, 762, fontB, 8.5, DARK);

  const gap   = 7;
  const cardW = (usable - 3 * gap) / 4;
  const cardH = 68;

  type KpiRow = { label: string; value: string; unit: string; accent: ReturnType<typeof rgb> }[];

  const row1: KpiRow = [
    { label: "Productividad Drone",  value: fmtN(data.productividad_drone),     unit: "t/h",
      accent: data.productividad_drone >= 32 ? GREEN : RED },
    { label: "Productividad Pesóm.", value: fmtN(data.productividad_pesometro), unit: "t/h",
      accent: data.productividad_pesometro >= 32 ? GREEN : RED },
    { label: "Inventario",           value: fmtN(data.inventario_ton, 0),       unit: "ton",
      accent: data.inventario_ton >= 7500 ? GREEN : data.inventario_ton >= 6500 ? AMBER : RED },
    { label: "Producción Drone",     value: fmtN(data.produccion_drone, 0),     unit: "ton",
      accent: DARK },
  ];

  const row2: KpiRow = [
    { label: "Horas Producción",     value: fmtN(data.horas_reales),            unit: "hrs",  accent: DARK },
    { label: "Detención",            value: fmtN(data.detencion),               unit: "hrs",
      accent: data.detencion > 0 ? RED : GREEN },
    { label: "Despachos",            value: fmtN(data.despachos_ton, 0),        unit: "ton",  accent: DARK },
    { label: "Viajes",               value: String(Math.round(data.cantidad_despachos)), unit: "", accent: DARK },
  ];

  const row1Y = 686;
  const row2Y = row1Y - cardH - gap;

  [row1, row2].forEach((row, ri) => {
    const cardY = ri === 0 ? row1Y : row2Y;
    row.forEach((k, ci) => {
      kpiCard(page, fontR, fontB, M + ci * (cardW + gap), cardY, cardW, cardH, k.label, k.value, k.unit, k.accent);
    });
  });

  // ── SECCIÓN: Tabla últimos registros ─────────────────────────────────────
  const tableTop = row2Y - 22;
  txt(page, "▌ ÚLTIMOS REGISTROS DE CUBICACIÓN", M, tableTop, fontB, 8.5, DARK);

  const historial = (data.historial ?? []).slice(0, 10);

  if (historial.length > 0) {
    // Cabecera tabla
    const cols = [
      { label: "Fecha / Hora",        w: 78,  align: "left"  },
      { label: "Prod. Drone (ton)",   w: 78,  align: "right" },
      { label: "Kpi Drone (t/h)",     w: 72,  align: "right" },
      { label: "Kpi Pesóm. (t/h)",    w: 72,  align: "right" },
      { label: "Hrs Prod.",           w: 54,  align: "right" },
      { label: "Detención",           w: 54,  align: "right" },
      { label: "Inventario (ton)",    w: 82,  align: "right" },
    ];

    const rowH   = 16;
    const hdrH   = 17;
    const tableY = tableTop - 10;

    // Header row
    drawRect(page, M, tableY - hdrH, usable, hdrH, DARK);
    let cx = M + 4;
    cols.forEach(c => {
      txt(page, c.label.toUpperCase(), cx, tableY - hdrH + 5, fontR, 6, WHITE);
      cx += c.w;
    });

    // Data rows
    historial.forEach((r, i) => {
      const ry = tableY - hdrH - (i + 1) * rowH;
      drawRect(page, M, ry, usable, rowH, i % 2 === 0 ? WHITE : STRIPE);

      const kpiD = r.horas_reales > 0 ? r.produccion_drone / r.horas_reales : 0;
      const kpiP = r.horas_reales > 0 ? r.productividad_pesometro           : 0;

      const isThis = r.fecha === data.fecha && r.hora.startsWith(data.hora);
      if (isThis) drawRect(page, M, ry, 3, rowH, GREEN);

      const cells = [
        `${r.fecha.split("-").reverse().join("/")}  ${r.hora.slice(0,5)}`,
        fmtN(r.produccion_drone, 0),
        fmtN(kpiD),
        fmtN(kpiP),
        fmtN(r.horas_reales),
        fmtN(r.detencion),
        fmtN(r.inventario_ton, 0),
      ];

      cx = M + 4;
      cells.forEach((cell, ci) => {
        const col   = cols[ci];
        const color = ci === 2 ? (kpiD >= 32 ? GREEN : RED) : DARK;
        const font  = isThis ? fontB : fontR;
        const xPos  = col.align === "right"
          ? M + cols.slice(0, ci).reduce((a, c) => a + c.w, 0) + col.w - fontR.widthOfTextAtSize(cell, 7.5) - 4
          : cx;
        txt(page, cell, xPos, ry + 4.5, font, 7.5, color);
        cx += col.w;
      });
    });

    // Leyenda
    const legendY = tableY - hdrH - (historial.length + 1) * rowH;
    drawRect(page, M, legendY, 6, 6, GREEN);
    txt(page, "Registro actual", M + 10, legendY + 0.5, fontR, 6.5, GRAY);
    txt(page, `Control de productividad: ≥ 32 t/h`, M + 90, legendY + 0.5, fontR, 6.5, GRAY);
  } else {
    txt(page, "Sin historial disponible", M, tableTop - 20, fontR, 8, GRAY);
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.4, color: rgb(0.88, 0.90, 0.93) });
  const now    = new Date().toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  txt(page, `Sistema de Control Arena · Migrin · Generado: ${now}`, M, 26, fontR, 7, GRAY);
  txt(page, "CONFIDENCIAL", W - M - fontR.widthOfTextAtSize("CONFIDENCIAL", 7), 26, fontR, 7, GRAY);

  return pdfDoc.save();
}
