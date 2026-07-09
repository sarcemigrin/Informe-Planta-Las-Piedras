/**
 * informe-pdf.ts  â€”  pdf-lib, sin canvas, serverless-safe
 * Genera 3 pÃ¡ginas A4: Portada + CubicaciÃ³n + Semanal
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

// â”€â”€â”€ Interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface RegistroResumen {
  fecha: string; hora: string;
  produccion_drone: number; productividad_drone: number;
  productividad_pesometro: number; horas_reales: number;
  detencion: number; despachos_ton: number; cantidad_despachos: number; inventario_ton: number;
  produccion_pesometro?: number | null;
  diferencia?: number | null;
}

export interface SemanaStat {
  semana: string; prodDrone: number; prodPeso: number;
  hrsProd: number; detencion: number; despachos: number; viajes: number;
}

export interface InformeData {
  fecha: string; hora: string;
  produccion_drone: number; productividad_drone: number;
  productividad_pesometro: number; diferencia_pesometro: number;
  horas_reales: number; detencion: number;
  despachos_ton: number; cantidad_despachos: number; inventario_ton: number;
  inventario_cuarzo?: number | null;
  usuario_email?: string;
  historial?: RegistroResumen[];      // registros para tabla
  historialChart?: RegistroResumen[]; // aÃ±o completo para grÃ¡fico
  semanalStats?: SemanaStat[];        // semanas del aÃ±o para grÃ¡fico y tabla
}

// â”€â”€â”€ Colores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DARK   = rgb(0.216, 0.255, 0.318);   // #374151
const GREEN  = rgb(0.420, 0.812, 0.498);   // #6BCF7F
const LIGHT  = rgb(0.965, 0.973, 0.984);   // fondo tarjeta
const STRIPE = rgb(0.976, 0.980, 0.988);   // fila alternada
const GRAY   = rgb(0.557, 0.604, 0.655);
const WHITE  = rgb(1, 1, 1);
const RED    = rgb(0.937, 0.267, 0.267);
const AMBER  = rgb(0.970, 0.650, 0.200);
const BLUE   = rgb(0.380, 0.490, 0.690);   // pesometro
const HEADER_BG  = rgb(0.972, 0.980, 0.988); // #f8fafc â€” fondo header claro
const SUBHDR_BG  = rgb(0.941, 0.949, 0.961); // franja subheader

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtN(n: number, dec = 1): string {
  if (!isFinite(n) || isNaN(n)) return "-";
  return n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function rect(page: PDFPage, x: number, y: number, w: number, h: number,
  fill: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill,
    ...(border ? { borderColor: border, borderWidth: 0.5 } : {}) });
}

function txt(page: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  try { page.drawText(String(text), { x, y, font, size, color }); } catch { /* skip */ }
}

function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number,
  color: ReturnType<typeof rgb>, thickness = 0.5, dash?: number[]) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
    thickness, color, ...(dash ? { dashArray: dash, dashPhase: 0 } : {}) });
}

// â”€â”€â”€ KPI card (pÃ¡gina 2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function kpiCard(page: PDFPage, fR: PDFFont, fB: PDFFont,
  x: number, y: number, w: number, h: number,
  label: string, value: string, unit: string, accent: ReturnType<typeof rgb>) {
  rect(page, x, y, w, h, LIGHT, rgb(0.882, 0.902, 0.925));
  rect(page, x, y, 3, h, accent);
  txt(page, label.toUpperCase(), x + 9, y + h - 16, fR, 6, GRAY);
  txt(page, value, x + 9, y + h / 2 - 5, fB, 16, DARK);
  if (unit) {
    const vw = fB.widthOfTextAtSize(value, 16);
    txt(page, unit, x + 9 + vw + 3, y + h / 2 - 3, fR, 7.5, GRAY);
  }
}

// â”€â”€â”€ Sparkline (mantenida para compatibilidad) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─── InfoCard uniforme (Opción 2) ─────────────────────────────────────────
function infoCard(page: PDFPage, fR: PDFFont, fB: PDFFont,
  x: number, y: number, w: number, h: number,
  label: string, value: string, unit: string,
  accent: ReturnType<typeof rgb>, sub?: string) {
  rect(page, x, y, w, h, LIGHT, rgb(0.882, 0.902, 0.925));
  rect(page, x, y, 3, h, accent);
  txt(page, label.toUpperCase(), x + 9, y + h - 14, fR, 5.5, GRAY);
  const vLen = value.length;
  const vSize = vLen > 10 ? 11 : vLen > 7 ? 13 : 15;
  const valY = sub ? y + h / 2 + 1 : y + h / 2 - vSize / 2 + 2;
  txt(page, value, x + 9, valY, fB, vSize, DARK);
  if (unit) {
    const vw = fB.widthOfTextAtSize(value, vSize);
    txt(page, unit, x + 9 + vw + 3, valY + 1, fR, 7, GRAY);
  }
  if (sub) txt(page, sub, x + 9, y + 10, fR, 6.5, GRAY);
}

function sparkline(page: PDFPage, fR: PDFFont,
  values: (number | null)[], labels: string[],
  x: number, y: number, w: number, h: number,
  color: ReturnType<typeof rgb>, refVal?: number) {
  const valid = values.filter((v): v is number => v !== null && isFinite(v));
  if (valid.length < 2) return;
  const minV = Math.min(...valid, refVal ?? Infinity) * 0.95;
  const maxV = Math.max(...valid, refVal ?? -Infinity) * 1.05;
  const range = maxV - minV || 1;
  const n = values.length;
  rect(page, x, y, w, h, LIGHT, rgb(0.88, 0.90, 0.92));
  for (let i = 0; i <= 4; i++) {
    const gy = y + (i / 4) * h;
    line(page, x, gy, x + w, gy, rgb(0.90, 0.92, 0.94));
    txt(page, fmtN(minV + (i / 4) * range, 0), x - 22, gy - 3, fR, 6, GRAY);
  }
  if (refVal !== undefined) {
    const ry = y + ((refVal - minV) / range) * h;
    if (ry >= y && ry <= y + h) {
      line(page, x, ry, x + w, ry, RED, 0.8, [4, 3]);
      txt(page, `Control ${fmtN(refVal, 0)}`, x + w - 42, ry + 2, fR, 6, RED);
    }
  }
  const step = Math.ceil(n / 8);
  labels.forEach((l, i) => {
    if (i % step === 0 || i === n - 1) {
      const px = x + (i / (n - 1)) * w;
      txt(page, l, px - 8, y - 9, fR, 5.5, GRAY);
    }
  });
  const pts = values.map((v, i) => ({
    px: x + (i / (n - 1)) * w,
    py: v !== null && isFinite(v) ? y + ((v - minV) / range) * h : null,
  }));
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1]; const p2 = pts[i];
    if (p1.py !== null && p2.py !== null)
      line(page, p1.px, p1.py, p2.px, p2.py, color, 1.5);
  }
  pts.forEach(p => {
    if (p.py !== null) page.drawCircle({ x: p.px, y: p.py, size: 2, color });
  });
}

// â”€â”€â”€ Mini bar chart (mantenida para compatibilidad) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function barChart(page: PDFPage, fR: PDFFont,
  values: number[], labels: string[],
  x: number, y: number, w: number, h: number,
  color: ReturnType<typeof rgb>) {
  if (!values.length) return;
  const maxV = Math.max(...values) || 1;
  const n = values.length;
  const bw = Math.max(2, (w - (n - 1) * 2) / n);
  rect(page, x, y, w, h, LIGHT, rgb(0.88, 0.90, 0.92));
  values.forEach((v, i) => {
    const bh = (v / maxV) * h;
    const bx = x + i * (bw + 2);
    rect(page, bx, y, bw, bh, color);
    if (labels[i] && n <= 12) txt(page, labels[i], bx + bw / 2 - 5, y - 9, fR, 5.5, GRAY);
  });
}

// â”€â”€â”€ Page header â€” claro / blanco â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function pageHeader(page: PDFPage, fR: PDFFont, fB: PDFFont,
  W: number, M: number, subtitle: string,
  fecha: string, hora: string, userEmail?: string) {
  // Fondo claro
  rect(page, 0, 792, W, 50, HEADER_BG);
  // Franja subheader
  rect(page, 0, 778, W, 14, SUBHDR_BG);
  // Barra verde izquierda â€” cubre toda la altura (header + subheader)
  rect(page, 0, 778, 5, 64, GREEN);
  // LÃ­nea verde separadora inferior
  line(page, 5, 778, W, 778, GREEN, 1.5);
  // Textos del header
  txt(page, "MIGRIN", M + 8, 826, fB, 15, DARK);
  txt(page, `Informe Produccion Arena  â€”  ${subtitle}`, M + 8, 811, fR, 8.5, GRAY);
  const dl = `${fecha.split("-").reverse().join("/")}   ${hora}`;
  const dw = fB.widthOfTextAtSize(dl, 10);
  txt(page, dl, W - M - dw, 824, fB, 10, DARK);
  if (userEmail) txt(page, userEmail, W - M - fR.widthOfTextAtSize(userEmail, 7.5), 811, fR, 7.5, GRAY);
  // Subheader
  txt(page, "Planta Las Piedras  -  Generado automaticamente al guardar registro", M + 8, 783, fR, 7.5, GRAY);
  txt(page, "CONFIDENCIAL", W - M - fR.widthOfTextAtSize("CONFIDENCIAL", 7.5), 783, fR, 7.5, GRAY);
}

function pageFooter(page: PDFPage, fR: PDFFont, W: number, M: number, pageNum: number) {
  line(page, M, 36, W - M, 36, rgb(0.88, 0.90, 0.93));
  const now = new Date().toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  txt(page, `Sistema de Control Arena - Migrin  -  ${now}  -  Pagina ${pageNum}`, M, 24, fR, 7, GRAY);
}

// â”€â”€â”€ Portada simple â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function coverPage(page: PDFPage, fR: PDFFont, fB: PDFFont,
  W: number, M: number,
  fecha: string, hora: string, userEmail?: string, semana?: string) {
  // Fondo blanco
  rect(page, 0, 0, W, 842, WHITE);
  // Barra verde izquierda
  rect(page, 0, 0, 6, 842, GREEN);
  // Franja oscura superior
  rect(page, 0, 800, W, 42, DARK);
  txt(page, "MIGRIN", M + 8, 826, fB, 15, WHITE);
  txt(page, "Sistema de Control Arena", M + 8, 812, fR, 8, rgb(0.70, 0.75, 0.80));

  // TÃ­tulo principal
  const titleY = 590;
  txt(page, "INFORME DE", M + 8, titleY, fB, 28, DARK);
  txt(page, "PRODUCCION ARENA", M + 8, titleY - 36, fB, 24, DARK);
  // Acento verde bajo el tÃ­tulo
  rect(page, M + 8, titleY - 52, 90, 4, GREEN);
  // SubtÃ­tulo
  txt(page, "Planta Las Piedras", M + 8, titleY - 74, fR, 14, GREEN);

  // LÃ­nea divisoria
  line(page, M + 8, titleY - 96, W - M, titleY - 96, rgb(0.882, 0.902, 0.925), 1);

  // Fecha de registro
  const fechaFmt = fecha.split("-").reverse().join("/");
  txt(page, "Fecha de registro", M + 8, titleY - 120, fR, 8, GRAY);
  txt(page, fechaFmt, M + 8, titleY - 136, fB, 14, DARK);
  if (semana) {
    txt(page, "Semana", M + 160, titleY - 120, fR, 8, GRAY);
    txt(page, semana, M + 160, titleY - 136, fB, 14, DARK);
  }

  // Generado por
  if (userEmail) {
    txt(page, "Generado por", M + 8, titleY - 168, fR, 8, GRAY);
    txt(page, userEmail, M + 8, titleY - 182, fR, 11, DARK);
  }
  txt(page, "Hora de generacion", M + 8, titleY - 208, fR, 8, GRAY);
  txt(page, hora, M + 8, titleY - 222, fR, 11, DARK);

  // Pie confidencial
  line(page, M + 8, 70, W - M, 70, rgb(0.882, 0.902, 0.925), 0.5);
  txt(page, "CONFIDENCIAL  -  Uso interno exclusivo  -  Migrin S.A.", M + 8, 54, fR, 8, GRAY);
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generarInformePDF(data: InformeData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595; const M = 28; const usable = W - 2 * M;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PORTADA
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const sem = data.semanalStats ?? [];

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PAGINA 1 â€” POR CUBICACION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const p1 = pdfDoc.addPage([W, 842]);

  pageHeader(p1, fR, fB, W, M, "Por Cubicacion",
    data.fecha, data.hora, data.usuario_email);

  // â”€â”€ KPI grande + mini â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const detPct = (data.horas_reales + data.detencion) > 0
    ? data.detencion / (data.horas_reales + data.detencion) * 100 : 0;

  // ── 8 InfoCards uniformes 2x4 (Opción 2) ───────────────────────────────────
  const prodPesoVal = data.productividad_pesometro * data.horas_reales;
  const difVal = data.diferencia_pesometro != null && isFinite(data.diferencia_pesometro)
    ? data.diferencia_pesometro : null;

  const cardW4 = Math.floor((usable - 3 * 5) / 4);
  const cardH4 = 55;
  const row1Y4 = 697;
  const row2Y4 = 637;

  txt(p1, "CUBICACION REGISTRADA", M, row1Y4 + cardH4 + 8, fB, 8.5, DARK);
  line(p1, M, row1Y4 + cardH4 + 5, M + 140, row1Y4 + cardH4 + 5, GREEN, 1.5);

  const c1r1: Array<{ l: string; v: string; u: string; a: ReturnType<typeof rgb>; sub?: string }> = [
    { l: "Ultimo droneo",       v: data.fecha.split("-").reverse().join("/"), u: data.hora.slice(0, 5), a: GRAY },
    { l: "Produccion Drone",    v: fmtN(data.produccion_drone, 0),            u: "ton",  a: GREEN },
    { l: "Productividad Drone", v: fmtN(data.productividad_drone),            u: "t/h",  a: data.productividad_drone >= 32 ? GREEN : RED },
    { l: "Prod. Pesometro",     v: fmtN(prodPesoVal, 0),                      u: "ton",  a: BLUE },
  ];
  const c1r2: Array<{ l: string; v: string; u: string; a: ReturnType<typeof rgb>; sub?: string }> = [
    { l: "Productiv. Pesometro", v: fmtN(data.productividad_pesometro),       u: "t/h",  a: data.productividad_pesometro >= 32 ? GREEN : RED },
    { l: "Despachos",            v: fmtN(data.despachos_ton, 0),              u: "ton",  a: DARK,
      sub: `${data.cantidad_despachos ?? 0} viajes` },
    { l: "Inventario",           v: fmtN(data.inventario_ton, 0),             u: "ton",  a: data.inventario_ton >= 7500 ? GREEN : data.inventario_ton >= 6500 ? AMBER : RED },
    { l: "Diferencia",           v: difVal != null ? `${(difVal * 100).toFixed(1)}%` : "-", u: "", a: difVal != null && Math.abs(difVal) > 0.1 ? RED : GREEN },
  ];

  [c1r1, c1r2].forEach((row, ri) => {
    const cy4 = ri === 0 ? row1Y4 : row2Y4;
    row.forEach((k, ci) => {
      infoCard(p1, fR, fB, M + ci * (cardW4 + 5), cy4, cardW4, cardH4, k.l, k.v, k.u, k.a, k.sub);
    });
  });

  const hist      = data.historial ?? [];
  const histChart = data.historialChart ?? hist;

  if (histChart.length >= 2) {
    const chartY = 370; const chartH = 230;
    const cX = M + 24; const cW = usable - 54;
    const yearLabel = histChart[0]?.fecha?.slice(0, 4) ?? new Date().getFullYear();
    txt(p1, `PRODUCTIVIDAD HISTORICA - ANO ${yearLabel}`, cX, chartY + chartH + 10, fB, 7.5, DARK);

    rect(p1, cX, chartY, cW, chartH, LIGHT, rgb(0.88, 0.90, 0.92));
    line(p1, cX,      chartY,          cX,      chartY + chartH, GRAY, 0.5);
    line(p1, cX,      chartY,          cX + cW, chartY,          GRAY, 0.5);
    line(p1, cX + cW, chartY,          cX + cW, chartY + chartH, GRAY, 0.5);
    line(p1, cX,      chartY + chartH, cX + cW, chartY + chartH, GRAY, 0.8);

    // Eje Y izq — productividad t/h
    const kpiDV = histChart.map(r => r.productividad_drone).filter(v => isFinite(v) && v > 0);
    const kpiPV = histChart.map(r => r.productividad_pesometro).filter(v => isFinite(v) && v > 0);
    const allKV = [...kpiDV, ...kpiPV].sort((a, b) => a - b);
    const maxK1 = Math.max(allKV[allKV.length - 1] ?? 40, 35) * 1.1;
    const rngK1 = maxK1 || 1;
    txt(p1, "t/h", M, chartY + chartH + 3, fR, 6, GRAY);
    for (let i = 0; i <= 4; i++) {
      const gy = chartY + (i / 4) * chartH;
      line(p1, cX, gy, cX + cW, gy, rgb(0.90, 0.92, 0.94), 0.4);
      const v1 = fmtN((maxK1 * i) / 4, 0);
      txt(p1, v1, cX - 3 - fR.widthOfTextAtSize(v1, 5.5), gy - 3, fR, 5.5, GRAY);
    }

    // Eje Y der — inventario ton
    const invV = histChart.map(r => r.inventario_ton).filter((v): v is number => v != null && isFinite(v) && v > 0);
    const maxI1 = invV.length > 0 ? Math.max(...invV) * 1.1 : 20000;
    txt(p1, "ton", cX + cW + 3, chartY + chartH + 3, fR, 6, GRAY);
    for (let i = 0; i <= 3; i++) {
      const gy = chartY + (i / 3) * chartH;
      txt(p1, fmtN(maxI1 * i / 3, 0), cX + cW + 3, gy - 3, fR, 5.5, GRAY);
    }

    // Labels eje X
    const n1 = histChart.length;
    const lbx1 = histChart.map(r => r.fecha.slice(5).replace("-", "/"));
    const stp1 = Math.max(1, Math.ceil(n1 / 8));
    lbx1.forEach((l, i) => {
      if (i % stp1 === 0 || i === n1 - 1) {
        const px = cX + (i / Math.max(n1 - 1, 1)) * cW;
        line(p1, px, chartY, px, chartY - 3, GRAY, 0.5);
        txt(p1, l, px - fR.widthOfTextAtSize(l, 5.5) / 2, chartY - 5, fR, 5.5, GRAY);
      }
    });

    const pyK1 = (v: number) =>
      chartY + Math.min(chartH, Math.max(0, (Math.min(v, maxK1) / rngK1) * chartH));

    // Linea productividad drone (GREEN)
    const ptD = histChart.map((r, i) => ({
      px: cX + (i / Math.max(n1 - 1, 1)) * cW,
      py: isFinite(r.productividad_drone) && r.productividad_drone > 0
        ? pyK1(r.productividad_drone) : null as number | null,
    }));
    for (let i = 1; i < ptD.length; i++) {
      const pa = ptD[i - 1]; const pb = ptD[i];
      if (pa.py !== null && pb.py !== null) line(p1, pa.px, pa.py, pb.px, pb.py, GREEN, 2);
    }
    ptD.forEach(p => { if (p.py !== null) p1.drawCircle({ x: p.px, y: p.py, size: 2, color: GREEN }); });

    // Linea productividad pesometro (DARK)
    const ptP = histChart.map((r, i) => ({
      px: cX + (i / Math.max(n1 - 1, 1)) * cW,
      py: isFinite(r.productividad_pesometro) && r.productividad_pesometro > 0
        ? pyK1(r.productividad_pesometro) : null as number | null,
    }));
    for (let i = 1; i < ptP.length; i++) {
      const pa = ptP[i - 1]; const pb = ptP[i];
      if (pa.py !== null && pb.py !== null) line(p1, pa.px, pa.py, pb.px, pb.py, DARK, 2);
    }
    ptP.forEach(p => { if (p.py !== null) p1.drawCircle({ x: p.px, y: p.py, size: 2, color: DARK }); });

    // Linea inventario (gris punteado, eje der.)
    const SGRAY1 = rgb(0.58, 0.64, 0.73);
    const ptI = histChart.map((r, i) => ({
      px: cX + (i / Math.max(n1 - 1, 1)) * cW,
      py: r.inventario_ton != null && isFinite(r.inventario_ton) && r.inventario_ton >= 0
        ? chartY + Math.min(chartH, Math.max(0, (r.inventario_ton / maxI1) * chartH)) : null as number | null,
    }));
    for (let i = 1; i < ptI.length; i++) {
      const pa = ptI[i - 1]; const pb = ptI[i];
      if (pa.py !== null && pb.py !== null) line(p1, pa.px, pa.py, pb.px, pb.py, SGRAY1, 1.5, [4, 3]);
    }

    // Control 32 t/h
    const refY1c = chartY + (32 / rngK1) * chartH;
    if (refY1c >= chartY && refY1c <= chartY + chartH) {
      line(p1, cX, refY1c, cX + cW, refY1c, RED, 0.8, [4, 3]);
      txt(p1, "Control 32 t/h", cX + cW - 56, refY1c + 2, fR, 5.5, RED);
    }

    // Leyenda
    line(p1, cX,       chartY + chartH + 4, cX + 8,   chartY + chartH + 4, GREEN,  2);
    txt(p1, "Productividad Drone (t/h)",     cX + 12,  chartY + chartH + 2, fR, 6, DARK);
    line(p1, cX + 132, chartY + chartH + 4, cX + 140, chartY + chartH + 4, DARK,   2);
    txt(p1, "Productividad Pesometro (t/h)", cX + 144, chartY + chartH + 2, fR, 6, DARK);
    line(p1, cX + 290, chartY + chartH + 4, cX + 298, chartY + chartH + 4, SGRAY1, 1.5, [4, 3]);
    txt(p1, "Inventario (ton, eje der.)",    cX + 302, chartY + chartH + 2, fR, 6, DARK);
  }

  const tblTop1 = 345;
  txt(p1, `ULTIMOS ${hist.length} REGISTROS DE CUBICACION`, M, tblTop1, fB, 7.5, DARK);
  line(p1, M, tblTop1 - 3, M + 130, tblTop1 - 3, GREEN, 1.2);

  const cols1 = [
    { l: "Fecha/Hora",  w: 77, r: false },
    { l: "KPI D.",      w: 47, r: true  },
    { l: "Prod. D.",    w: 52, r: true  },
    { l: "Hrs Pr.",     w: 41, r: true  },
    { l: "Deten.",      w: 41, r: true  },
    { l: "Inv.",        w: 52, r: true  },
    { l: "Vj.",         w: 28, r: true  },
    { l: "Desp.",       w: 48, r: true  },
    { l: "KPI P.",      w: 47, r: true  },
    { l: "Prod. P.",    w: 52, r: true  },
    { l: "Dif.",        w: 36, r: true  },
  ];

  const hdrH = 12; const rowH = 12; // compacto â€” cabe mÃ¡s registros
  const tblY1 = tblTop1 - 10;

  // Encabezado tabla
  rect(p1, M, tblY1 - hdrH, usable, hdrH, DARK);
  let cx = M + 3;
  cols1.forEach(c => {
    txt(p1, c.l.toUpperCase(), cx, tblY1 - hdrH + 3.5, fR, 5, WHITE);
    cx += c.w;
  });

  // Filas
  const display1 = [...hist].reverse();
  display1.forEach((r, i) => {
    const ry = tblY1 - hdrH - (i + 1) * rowH;
    if (ry < 45) return;
    rect(p1, M, ry, usable, rowH, i % 2 === 0 ? WHITE : STRIPE);
    const isCurr = r.fecha === data.fecha && r.hora.startsWith(data.hora.slice(0, 5));
    if (isCurr) rect(p1, M, ry, 3, rowH, GREEN);

    const kpiD = r.horas_reales > 0 ? r.produccion_drone / r.horas_reales : 0;
    const difStr = r.diferencia != null ? (r.diferencia * 100).toFixed(1) + "%" : "-";
    const difCol = r.diferencia != null && Math.abs(r.diferencia) > 0.1
      ? (r.diferencia > 0 ? RED : GREEN) : DARK;
    const cells = [
      { v: `${r.fecha.split("-").reverse().join("/")} ${r.hora.slice(0, 5)}`, r: false },
      { v: fmtN(kpiD),                                       r: true, color: kpiD >= 32 ? GREEN : RED },
      { v: fmtN(r.produccion_drone, 0),                      r: true },
      { v: fmtN(r.horas_reales),                             r: true },
      { v: fmtN(r.detencion),                                r: true, color: r.detencion > 0 ? RED : DARK },
      { v: fmtN(r.inventario_ton, 0),                        r: true },
      { v: r.cantidad_despachos ? String(r.cantidad_despachos) : "-", r: true },
      { v: fmtN(r.despachos_ton, 0),                         r: true },
      { v: fmtN(r.productividad_pesometro),                  r: true },
      { v: fmtN(r.produccion_pesometro ?? 0, 0),             r: true },
      { v: difStr,                                            r: true, color: difCol },
    ];

    cx = M + 3;
    cells.forEach((cell, ci) => {
      const col = cols1[ci];
      const xPos = cell.r
        ? M + cols1.slice(0, ci).reduce((a, c) => a + c.w, 0) + col.w - fR.widthOfTextAtSize(cell.v, 5.5) - 3
        : cx;
      txt(p1, cell.v, xPos, ry + 3, isCurr ? fB : fR, 5.5, cell.color ?? DARK);
      cx += col.w;
    });
  });

  pageFooter(p1, fR, W, M, 1);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PAGINA 2 â€” POR SEMANA
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const p2 = pdfDoc.addPage([W, 842]);
  pageHeader(p2, fR, fB, W, M, "Por Semana", data.fecha, data.hora, data.usuario_email);

  const gap = 7; const cw = (usable - 3 * gap) / 4; const ch = 52;

  const lastSem = sem[sem.length - 1];

  if (lastSem) {
    txt(p2, `SEMANA ACTUAL: ${lastSem.semana}`, M, 760, fB, 8.5, DARK);
    line(p2, M, 757, M + 120, 757, GREEN, 1.5);

    const semKpiD = lastSem.hrsProd > 0 ? lastSem.prodDrone / lastSem.hrsProd : 0;
    const semKpiP = lastSem.hrsProd > 0 ? lastSem.prodPeso  / lastSem.hrsProd : 0;
    const semDetPct = (lastSem.hrsProd + lastSem.detencion) > 0
      ? lastSem.detencion / (lastSem.hrsProd + lastSem.detencion) * 100 : 0;

    // Fila 1 — Semana, Hrs Productivas, Detención, Despachos
    const sRow1 = [
      { l: "Semana",
        v: (lastSem.semana.includes("-") ? lastSem.semana.split("-")[1] : lastSem.semana),
        u: lastSem.semana.slice(0, 4), a: GRAY },
      { l: "Hrs Productivas", v: fmtN(lastSem.hrsProd, 1),   u: "hrs",                           a: DARK },
      { l: "Detencion",       v: `${fmtN(lastSem.detencion, 1)} hrs`, u: `${fmtN(semDetPct, 0)}%`, a: lastSem.detencion > 0 ? RED : GREEN },
      { l: "Despachos",       v: fmtN(lastSem.despachos, 0), u: "ton",                           a: DARK },
    ];
    // Fila 2 — KPI Drone, Prod Drone, KPI Pesometro, Prod Pesometro
    const sRow2 = [
      { l: "Productividad Drone",  v: fmtN(semKpiD),              u: "t/h", a: semKpiD >= 32 ? GREEN : RED },
      { l: "Produccion Drone",     v: fmtN(lastSem.prodDrone, 0), u: "ton", a: DARK },
      { l: "Productividad Pesom.", v: fmtN(semKpiP),              u: "t/h", a: semKpiP >= 32 ? GREEN : RED },
      { l: "Produccion Pesom.",    v: fmtN(lastSem.prodPeso, 0),  u: "ton", a: BLUE },
    ];

    [sRow1, sRow2].forEach((row, ri) => {
      const cy = ri === 0 ? 684 : 684 - ch - gap;
      row.forEach((k, ci) => kpiCard(p2, fR, fB, M + ci * (cw + gap), cy, cw, ch, k.l, k.v, k.u, k.a));
    });
  }

  if (sem.length >= 2) {
    const sem10 = sem.slice(-10);
    const chartY2 = 510; const chartH2 = 92;
    const cX2 = M + 24; const cW2 = usable - 54;
    txt(p2, "PRODUCCION SEMANAL - ULTIMAS 10 SEMANAS", cX2, chartY2 + chartH2 + 10, fB, 7.5, DARK);

    rect(p2, cX2, chartY2, cW2, chartH2, LIGHT, rgb(0.88, 0.90, 0.92));
    line(p2, cX2,       chartY2,           cX2,       chartY2 + chartH2, GRAY, 0.5);
    line(p2, cX2,       chartY2,           cX2 + cW2, chartY2,           GRAY, 0.5);
    line(p2, cX2 + cW2, chartY2,           cX2 + cW2, chartY2 + chartH2, GRAY, 0.5);
    line(p2, cX2,       chartY2 + chartH2, cX2 + cW2, chartY2 + chartH2, GRAY, 0.8);

    // Eje Y izq — ton
    const allProd2 = sem10.flatMap(s => [s.prodDrone, s.prodPeso]).filter(v => v > 0).sort((a, b) => a - b);
    const maxP2    = allProd2.length > 0 ? allProd2[allProd2.length - 1] * 1.08 : 1;
    txt(p2, "ton", M, chartY2 + chartH2 + 3, fR, 6, GRAY);
    for (let gi = 0; gi <= 4; gi++) {
      const gy = chartY2 + (gi / 4) * chartH2;
      line(p2, cX2, gy, cX2 + cW2, gy, rgb(0.90, 0.92, 0.94), 0.4);
      const val = fmtN(maxP2 * gi / 4, 0);
      txt(p2, val, cX2 - 3 - fR.widthOfTextAtSize(val, 5.5), gy - 3, fR, 5.5, GRAY);
    }

    // Eje Y der — t/h
    const allKpiD2 = sem10.filter(s => s.hrsProd > 0).map(s => s.prodDrone / s.hrsProd).filter(v => isFinite(v) && v > 0);
    const allKpiP2 = sem10.filter(s => s.hrsProd > 0).map(s => s.prodPeso  / s.hrsProd).filter(v => isFinite(v) && v > 0);
    const allKpi2  = [...allKpiD2, ...allKpiP2].sort((a, b) => a - b);
    const maxK2    = Math.max(allKpi2[allKpi2.length - 1] ?? 40, 35) * 1.08;
    const minK2    = 0;
    const rangeK2  = maxK2 - minK2 || 1;
    txt(p2, "t/h", cX2 + cW2 + 3, chartY2 + chartH2 + 3, fR, 6, GRAY);
    for (let ki = 0; ki <= 3; ki++) {
      const gy  = chartY2 + (ki / 3) * chartH2;
      txt(p2, fmtN(minK2 + (ki / 3) * rangeK2, 0), cX2 + cW2 + 3, gy - 3, fR, 5.5, GRAY);
    }

    // Barras agrupadas
    const groupW2 = Math.max(11, Math.floor(cW2 / sem10.length));
    const bw2     = Math.max(3,  Math.floor((groupW2 - 2) / 2));
    const startX2 = cX2 + Math.floor((cW2 - sem10.length * groupW2) / 2);

    sem10.forEach((s, i) => {
      const bhD = Math.min(chartH2, Math.max(0, (s.prodDrone / maxP2) * chartH2));
      const bhP = Math.min(chartH2, Math.max(0, (s.prodPeso  / maxP2) * chartH2));
      const bx  = startX2 + i * groupW2;
      if (bhD > 0) rect(p2, bx,           chartY2, bw2, bhD, GREEN);
      if (bhP > 0) rect(p2, bx + bw2 + 1, chartY2, bw2, bhP, DARK);
      const label = s.semana.includes("-") ? s.semana.split("-")[1] : s.semana;
      const cx2lbl = bx + bw2;
      line(p2, cx2lbl, chartY2, cx2lbl, chartY2 - 3, GRAY, 0.5);
      txt(p2, label, cx2lbl - fR.widthOfTextAtSize(label, 5.5) / 2, chartY2 - 5, fR, 5.5, GRAY);
    });

    // Lineas KPI sobre barras
    const centerOf2 = (i: number) => startX2 + i * groupW2 + bw2;
    const kpiSeriesD = sem10.map(s => s.hrsProd > 0 ? s.prodDrone / s.hrsProd : null);
    const kpiSeriesP = sem10.map(s => s.hrsProd > 0 ? s.prodPeso  / s.hrsProd : null);

    const drawKpiLine2 = (vals: (number | null)[], color: ReturnType<typeof rgb>) => {
      const pts = vals.map((v, i) => ({
        px: centerOf2(i),
        py: v !== null && isFinite(v) && v > 0
          ? chartY2 + Math.min(chartH2, Math.max(0, ((Math.min(v, maxK2) - minK2) / rangeK2) * chartH2))
          : null as number | null,
      }));
      for (let i = 1; i < pts.length; i++) {
        const pa = pts[i - 1]; const pb = pts[i];
        if (pa.py !== null && pb.py !== null) line(p2, pa.px, pa.py, pb.px, pb.py, color, 1.5);
      }
      pts.forEach(pt => { if (pt.py !== null) p2.drawCircle({ x: pt.px, y: pt.py, size: 1.5, color }); });
    };
    drawKpiLine2(kpiSeriesD, AMBER);
    drawKpiLine2(kpiSeriesP, BLUE);

    // Referencia 32 t/h
    const refK2 = chartY2 + ((32 - minK2) / rangeK2) * chartH2;
    if (refK2 >= chartY2 && refK2 <= chartY2 + chartH2) {
      line(p2, cX2, refK2, cX2 + cW2, refK2, RED, 0.8, [4, 3]);
      txt(p2, "32 t/h", cX2 + cW2 - 24, refK2 + 2, fR, 5.5, RED);
    }

    // Leyenda
    rect(p2, cX2, chartY2 + chartH2 + 2, 8, 4, GREEN);
    txt(p2, "Prod. Drone (ton)", cX2 + 11, chartY2 + chartH2 + 2, fR, 6, DARK);
    rect(p2, cX2 + 92, chartY2 + chartH2 + 2, 8, 4, DARK);
    txt(p2, "Prod. Pesometro (ton)", cX2 + 103, chartY2 + chartH2 + 2, fR, 6, DARK);
    line(p2, cX2 + 200, chartY2 + chartH2 + 4, cX2 + 208, chartY2 + chartH2 + 4, AMBER, 1.5);
    txt(p2, "KPI Drone (t/h, eje der.)", cX2 + 212, chartY2 + chartH2 + 2, fR, 6, DARK);
    line(p2, cX2 + 318, chartY2 + chartH2 + 4, cX2 + 326, chartY2 + chartH2 + 4, BLUE, 1.5);
    txt(p2, "KPI Pesometro (t/h, eje der.)", cX2 + 330, chartY2 + chartH2 + 2, fR, 6, DARK);
  }

  const tblTop2 = 490;
  txt(p2, "RESUMEN SEMANAL - ANO COMPLETO", M, tblTop2, fB, 7.5, DARK);
  line(p2, M, tblTop2 - 3, M + 145, tblTop2 - 3, GREEN, 1.2);

  const cols2 = [
    { l: "Semana",   w: 60, r: false },
    { l: "KPI D.",   w: 47, r: true  },
    { l: "Prod. D.", w: 60, r: true  },
    { l: "KPI P.",   w: 47, r: true  },
    { l: "Prod. P.", w: 60, r: true  },
    { l: "Hrs Pr.",  w: 48, r: true  },
    { l: "Deten.",   w: 48, r: true  },
    { l: "Desp.",    w: 60, r: true  },
    { l: "Viajes",   w: 39, r: true  },
  ];

  const hdrH2 = 14; const rowH2 = 16;
  const tblY2 = tblTop2 - 10;

  rect(p2, M, tblY2 - hdrH2, usable, hdrH2, DARK);
  let cx2 = M + 3;
  cols2.forEach(c => {
    txt(p2, c.l.toUpperCase(), cx2, tblY2 - hdrH2 + 4, fR, 5.5, WHITE);
    cx2 += c.w;
  });

  const semDisplay = [...sem].reverse();
  semDisplay.forEach((s, i) => {
    const ry = tblY2 - hdrH2 - (i + 1) * rowH2;
    if (ry < 30) return;
    rect(p2, M, ry, usable, rowH2, i % 2 === 0 ? WHITE : STRIPE);

    const isCurrentSem = s === lastSem;
    if (isCurrentSem) rect(p2, M, ry, 3, rowH2, GREEN);

    const kpiD2 = s.hrsProd > 0 ? s.prodDrone / s.hrsProd : 0;
    const kpiP2 = s.hrsProd > 0 ? s.prodPeso  / s.hrsProd : 0;

    const cells2 = [
      { v: s.semana,             r: false },
      { v: fmtN(kpiD2),          r: true, color: kpiD2 >= 32 ? GREEN : RED },
      { v: fmtN(s.prodDrone, 0), r: true },
      { v: fmtN(kpiP2),          r: true, color: kpiP2 >= 32 ? GREEN : RED },
      { v: fmtN(s.prodPeso, 0),  r: true },
      { v: fmtN(s.hrsProd, 1),   r: true },
      { v: fmtN(s.detencion, 1), r: true, color: s.detencion > 0 ? RED : DARK },
      { v: fmtN(s.despachos, 0), r: true },
      { v: String(s.viajes),     r: true },
    ];

    cx2 = M + 3;
    cells2.forEach((cell, ci) => {
      const col = cols2[ci];
      const xPos = cell.r
        ? M + cols2.slice(0, ci).reduce((a, c) => a + c.w, 0) + col.w - fR.widthOfTextAtSize(cell.v, 6.5) - 3
        : cx2;
      txt(p2, cell.v, xPos, ry + 4, isCurrentSem ? fB : fR, 6.5, (cell as { color?: ReturnType<typeof rgb> }).color ?? DARK);
      cx2 += col.w;
    });
  });

  pageFooter(p2, fR, W, M, 2);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
