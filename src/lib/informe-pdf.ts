/**
 * informe-pdf.ts
 * Genera un PDF de informe de cubicación usando pdf-lib (puro JS, sin canvas).
 * Se usa desde la API route /api/informe/generate-report.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export interface InformeData {
  fecha:                   string;   // "2026-06-25"
  hora:                    string;   // "08:30"
  produccion_drone:        number;   // ton
  productividad_drone:     number;   // t/h
  productividad_pesometro: number;   // t/h
  diferencia_pesometro:    number;   // ton (producción pesómetro)
  horas_reales:            number;   // hrs
  detencion:               number;   // hrs
  despachos_ton:           number;   // ton
  cantidad_despachos:      number;   // viajes
  inventario_ton:          number;   // ton
  usuario_email?:          string;
}

// ── Colores corporativos ─────────────────────────────────────────────────────
const DARK  = rgb(0.216, 0.255, 0.318);   // #374151 gris antracita
const GREEN = rgb(0.420, 0.812, 0.498);   // #6BCF7F migrin green
const LIGHT = rgb(0.965, 0.973, 0.984);   // #f6f8fb fondo tarjeta
const GRAY  = rgb(0.557, 0.604, 0.655);   // #8e9aa7 texto secundario
const WHITE = rgb(1, 1, 1);
const RED   = rgb(0.937, 0.267, 0.267);   // #ef4444

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtN(n: number, dec = 1): string {
  if (!isFinite(n) || isNaN(n)) return "–";
  return n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function drawRect(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  fillColor: ReturnType<typeof rgb>,
  borderColor?: ReturnType<typeof rgb>,
) {
  page.drawRectangle({
    x, y, width: w, height: h,
    color: fillColor,
    ...(borderColor ? { borderColor, borderWidth: 0.5 } : {}),
  });
}

function drawText(
  page: PDFPage,
  text: string,
  x: number, y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  page.drawText(text, { x, y, font, size, color });
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function drawKpiCard(
  page: PDFPage,
  fontR: PDFFont, fontB: PDFFont,
  x: number, y: number, w: number, h: number,
  label: string, value: string, unit: string,
  accent?: ReturnType<typeof rgb>,
) {
  const border = rgb(0.882, 0.902, 0.925);  // #e1e7ec
  drawRect(page, x, y, w, h, LIGHT, border);

  // Acento izquierdo (barra verde)
  if (accent) {
    drawRect(page, x, y, 3, h, accent);
  }

  // Label
  const labelY = y + h - 18;
  drawText(page, label.toUpperCase(), x + 10, labelY, fontR, 6, GRAY);

  // Value
  const valY = y + h / 2 - 6;
  drawText(page, value, x + 10, valY, fontB, 18, DARK);

  // Unit
  if (unit) {
    const valWidth = fontB.widthOfTextAtSize(value, 18);
    drawText(page, unit, x + 10 + valWidth + 4, valY + 2, fontR, 8, GRAY);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generarInformePDF(data: InformeData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([595, 842]); // A4

  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595;
  const MARGIN = 30;

  // ── HEADER ────────────────────────────────────────────────────────────────
  drawRect(page, 0, 782, W, 60, DARK);
  // Barra verde lateral
  drawRect(page, 0, 782, 5, 60, GREEN);
  // Título
  drawText(page, "MIGRIN", MARGIN, 824, fontB, 18, WHITE);
  drawText(page, "Informe de Cubicación Arena", MARGIN, 807, fontR, 10, rgb(0.7, 0.75, 0.8));
  // Fecha y hora alineadas a la derecha
  const dateStr = data.fecha.split("-").reverse().join("/");
  const dateLabel = `${dateStr}  ${data.hora}`;
  const dw = fontB.widthOfTextAtSize(dateLabel, 11);
  drawText(page, dateLabel, W - MARGIN - dw, 821, fontB, 11, WHITE);
  drawText(page, "Registro guardado", W - MARGIN - fontR.widthOfTextAtSize("Registro guardado", 8), 807, fontR, 8, rgb(0.6, 0.65, 0.7));

  // ── INFO STRIP ────────────────────────────────────────────────────────────
  drawRect(page, 0, 760, W, 22, rgb(0.243, 0.282, 0.349)); // slightly lighter than header
  const infoText = `Generado automáticamente al guardar droneo${data.usuario_email ? `  ·  ${data.usuario_email}` : ""}`;
  drawText(page, infoText, MARGIN, 768, fontR, 8, rgb(0.65, 0.70, 0.76));

  // ── SECTION TITLE: KPIs ──────────────────────────────────────────────────
  drawRect(page, MARGIN, 732, 4, 14, GREEN);
  drawText(page, "INDICADORES DEL REGISTRO", MARGIN + 10, 733, fontB, 9, DARK);

  // ── KPI GRID: 4 × 2 ──────────────────────────────────────────────────────
  const usable   = W - 2 * MARGIN;          // 535
  const gap      = 8;
  const cardW    = (usable - 3 * gap) / 4;  // ≈ 126
  const cardH    = 72;
  const row1Y    = 648;                      // bottom of row 1
  const row2Y    = row1Y - cardH - gap;      // bottom of row 2

  interface KpiDef {
    label: string;
    value: string;
    unit:  string;
    accent?: ReturnType<typeof rgb>;
  }

  const kpiRow1: KpiDef[] = [
    {
      label:  "Productividad Drone",
      value:  fmtN(data.productividad_drone),
      unit:   "t/h",
      accent: data.productividad_drone >= 32 ? GREEN : RED,
    },
    {
      label:  "Productividad Pesóm.",
      value:  fmtN(data.productividad_pesometro),
      unit:   "t/h",
      accent: data.productividad_pesometro >= 32 ? GREEN : RED,
    },
    {
      label:  "Inventario",
      value:  fmtN(data.inventario_ton, 0),
      unit:   "ton",
      accent: data.inventario_ton >= 7500 ? GREEN : data.inventario_ton >= 6500 ? rgb(0.97, 0.65, 0.2) : RED,
    },
    {
      label:  "Producción Drone",
      value:  fmtN(data.produccion_drone, 0),
      unit:   "ton",
      accent: DARK,
    },
  ];

  const kpiRow2: KpiDef[] = [
    {
      label:  "Horas Producción",
      value:  fmtN(data.horas_reales),
      unit:   "hrs",
      accent: DARK,
    },
    {
      label:  "Detención",
      value:  fmtN(data.detencion),
      unit:   "hrs",
      accent: data.detencion > 0 ? RED : GREEN,
    },
    {
      label:  "Despachos",
      value:  fmtN(data.despachos_ton, 0),
      unit:   "ton",
      accent: DARK,
    },
    {
      label:  "Viajes",
      value:  String(Math.round(data.cantidad_despachos)),
      unit:   "",
      accent: DARK,
    },
  ];

  [kpiRow1, kpiRow2].forEach((row, rowIdx) => {
    const cardY = rowIdx === 0 ? row1Y : row2Y;
    row.forEach((kpi, colIdx) => {
      const cardX = MARGIN + colIdx * (cardW + gap);
      drawKpiCard(page, fontR, fontB, cardX, cardY, cardW, cardH, kpi.label, kpi.value, kpi.unit, kpi.accent);
    });
  });

  // ── PRODUCCIÓN PESÓMETRO ──────────────────────────────────────────────────
  const row2Bottom = row2Y - gap;
  drawRect(page, MARGIN, row2Bottom - 40, 4, 14, DARK);
  drawText(page, "PRODUCCIÓN PESÓMETRO", MARGIN + 10, row2Bottom - 39, fontB, 9, DARK);
  drawText(page, fmtN(data.diferencia_pesometro, 0) + " ton", MARGIN + 10, row2Bottom - 55, fontB, 14, DARK);
  drawText(page, `productividad: ${fmtN(data.productividad_pesometro)} t/h`, MARGIN + 10, row2Bottom - 68, fontR, 8, GRAY);

  // ── DIVIDER ───────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y: row2Bottom - 85 },
    end:   { x: W - MARGIN, y: row2Bottom - 85 },
    thickness: 0.5,
    color: rgb(0.882, 0.902, 0.925),
  });

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const now = new Date();
  const nowStr = now.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  drawText(page, `Generado: ${nowStr}  ·  Sistema de Control Arena — Migrin`, MARGIN, 28, fontR, 7, GRAY);
  drawText(page, "CONFIDENCIAL", W - MARGIN - fontR.widthOfTextAtSize("CONFIDENCIAL", 7), 28, fontR, 7, GRAY);

  return pdfDoc.save();
}
