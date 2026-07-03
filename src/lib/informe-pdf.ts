/**
 * informe-pdf.ts  —  pdf-lib, sin canvas, serverless-safe
 * Genera 2 páginas A4: Cubicación + Semanal
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

// ─── Interfaces ───────────────────────────────────────────────────────────────
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
  historial?: RegistroResumen[];      // últimos 10 para tabla
  historialChart?: RegistroResumen[]; // año completo para gráfico
  semanalStats?: SemanaStat[];        // semanas del año para gráfico y tabla
}

// ─── Colores ─────────────────────────────────────────────────────────────────
const DARK   = rgb(0.216, 0.255, 0.318);   // #374151
const GREEN  = rgb(0.420, 0.812, 0.498);   // #6BCF7F
const LIGHT  = rgb(0.965, 0.973, 0.984);   // fondo tarjeta
const STRIPE = rgb(0.976, 0.980, 0.988);   // fila alternada
const GRAY   = rgb(0.557, 0.604, 0.655);
const WHITE  = rgb(1, 1, 1);
const RED    = rgb(0.937, 0.267, 0.267);
const AMBER  = rgb(0.970, 0.650, 0.200);
const BLUE   = rgb(0.380, 0.490, 0.690);   // pesometro

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── KPI card ────────────────────────────────────────────────────────────────
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

// ─── Sparkline ───────────────────────────────────────────────────────────────
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

// ─── Mini bar chart ──────────────────────────────────────────────────────────
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
    if (labels[i] && n <= 12) {
      txt(page, labels[i], bx + bw / 2 - 5, y - 9, fR, 5.5, GRAY);
    }
  });
}

// ─── Page header ─────────────────────────────────────────────────────────────
function pageHeader(page: PDFPage, fR: PDFFont, fB: PDFFont,
  W: number, M: number, subtitle: string,
  fecha: string, hora: string, userEmail?: string) {
  rect(page, 0, 792, W, 50, DARK);
  rect(page, 0, 792, 5, 50, GREEN);
  txt(page, "MIGRIN", M + 2, 826, fB, 15, WHITE);
  txt(page, `Informe Produccion Arena  -  ${subtitle}`, M + 2, 810, fR, 8.5, rgb(0.70, 0.75, 0.80));
  const dl = `${fecha.split("-").reverse().join("/")}   ${hora}`;
  const dw = fB.widthOfTextAtSize(dl, 10);
  txt(page, dl, W - M - dw, 824, fB, 10, WHITE);
  if (userEmail) txt(page, userEmail, W - M - fR.widthOfTextAtSize(userEmail, 7.5), 810, fR, 7.5, rgb(0.60, 0.65, 0.72));
  rect(page, 0, 778, W, 14, rgb(0.243, 0.282, 0.349));
  txt(page, "Planta Las Piedras  -  Generado automaticamente al guardar registro", M, 783, fR, 7.5, rgb(0.65, 0.70, 0.76));
  txt(page, "CONFIDENCIAL", W - M - fR.widthOfTextAtSize("CONFIDENCIAL", 7.5), 783, fR, 7.5, rgb(0.65, 0.70, 0.76));
}

function pageFooter(page: PDFPage, fR: PDFFont, W: number, M: number, pageNum: number) {
  line(page, M, 36, W - M, 36, rgb(0.88, 0.90, 0.93));
  const now = new Date().toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  txt(page, `Sistema de Control Arena - Migrin  -  ${now}  -  Pagina ${pageNum}`, M, 24, fR, 7, GRAY);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function generarInformePDF(data: InformeData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595; const M = 28; const usable = W - 2 * M;

  // ════════════════════════════════════════════════════════════════
  //  PAGINA 1 — POR CUBICACION
  // ════════════════════════════════════════════════════════════════
  const p1 = pdfDoc.addPage([W, 842]);

  pageHeader(p1, fR, fB, W, M, "Por Cubicacion",
    data.fecha, data.hora, data.usuario_email);

  // ── Tarjeta del dato — registro actual ────────────────────────────────────
  const detPct = (data.horas_reales + data.detencion) > 0
    ? data.detencion / (data.horas_reales + data.detencion) * 100 : 0;

  const crdY = 622; const crdH = 142; const crdW = usable;
  const hStripH = 28;
  const bodyH = crdH - hStripH; // 114px
  const rowH4 = Math.floor(bodyH / 2); // 57px per data row
  const col4 = Math.floor((crdW - 4) / 4); // 4 columns (exclude left accent)
  const x0 = M + 4;

  // Outer card
  rect(p1, M, crdY, crdW, crdH, LIGHT, rgb(0.80, 0.86, 0.92));
  // Green left accent
  rect(p1, M, crdY, 4, crdH, GREEN);
  // Header strip (top of card)
  rect(p1, M, crdY + crdH - hStripH, crdW, hStripH, DARK);
  txt(p1, "CUBICACION REGISTRADA", x0 + 6, crdY + crdH - 8, fB, 10, WHITE);
  const dlFmt = `${data.fecha.split("-").reverse().join("/")}   ${data.hora}`;
  const dlFmtW = fB.widthOfTextAtSize(dlFmt, 10);
  txt(p1, dlFmt, M + crdW - dlFmtW - 8, crdY + crdH - 8, fB, 10, GREEN);
  if (data.usuario_email) {
    txt(p1, `Registrado por: ${data.usuario_email}`, x0 + 6, crdY + crdH - 19, fR, 7, rgb(0.58, 0.66, 0.76));
  }

  // Horizontal separator between body rows
  const rowSepY = crdY + rowH4;
  line(p1, x0, rowSepY, x0 + crdW - 4, rowSepY, rgb(0.82, 0.88, 0.93));
  // Vertical column separators
  [1, 2, 3].forEach(ci => line(p1, x0 + ci * col4, crdY + 3, x0 + ci * col4, crdY + bodyH - 4, rgb(0.82, 0.88, 0.93)));

  // Data rows: [label_y, value_y] relative to body top (crdY+bodyH)
  const bodyTop = crdY + bodyH;
  const dataRows4: Array<{ l: string; v: string; c: ReturnType<typeof rgb> }[]> = [
    [
      { l: "KPI DRONE",        v: `${fmtN(data.productividad_drone)} t/h`,      c: data.productividad_drone  >= 32 ? GREEN : RED },
      { l: "PRODUCCION DRONE", v: `${fmtN(data.produccion_drone, 0)} ton`,       c: DARK },
      { l: "KPI PESOMETRO",    v: `${fmtN(data.productividad_pesometro)} t/h`,   c: data.productividad_pesometro >= 32 ? GREEN : RED },
      { l: "PROD. PESOMETRO",  v: `${fmtN(Math.max(0, data.productividad_pesometro * data.horas_reales), 0)} ton`, c: BLUE },
    ],
    [
      { l: "HRS PRODUCCION",   v: `${fmtN(data.horas_reales)} hrs`,              c: DARK },
      { l: "DETENCION",        v: `${fmtN(data.detencion)} hrs  (${fmtN(detPct, 0)}%)`, c: data.detencion > 0 ? RED : GREEN },
      { l: "INVENTARIO",       v: `${fmtN(data.inventario_ton, 0)} ton`,          c: data.inventario_ton >= 7500 ? GREEN : data.inventario_ton >= 6500 ? AMBER : RED },
      { l: "DESPACHOS",        v: `${fmtN(data.despachos_ton, 0)} ton  /  ${data.cantidad_despachos ?? 0} viajes`, c: DARK },
    ],
  ];

  dataRows4.forEach((row, ri) => {
    // Row 0: upper body (bodyTop to bodyTop-rowH4)
    // Row 1: lower body (rowSepY to crdY)
    const rowTop = bodyTop - ri * rowH4;
    row.forEach((cell, ci) => {
      const cx = x0 + ci * col4 + 8;
      txt(p1, cell.l, cx, rowTop - 10, fR, 5.5, GRAY);
      const vLen = cell.v.length;
      const vSize = vLen > 16 ? 10.5 : vLen > 12 ? 12 : 14;
      txt(p1, cell.v, cx, rowTop - 10 - vSize - 4, fB, vSize, cell.c);
    });
  });

  // Nota cuarzo + diferencia debajo de la tarjeta
  {
    const noteY = crdY - 14;
    const difPct = data.diferencia_pesometro != null && isFinite(data.diferencia_pesometro)
      ? (data.diferencia_pesometro * 100).toFixed(1) + "%" : "-";
    let noteStr = `Dif. Drone vs Pesometro: ${difPct}`;
    if (data.inventario_cuarzo != null && isFinite(data.inventario_cuarzo)) {
      noteStr += `     Inv. Cuarzo: ${fmtN(data.inventario_cuarzo, 0)} ton`;
    }
    txt(p1, noteStr, M + 6, noteY, fR, 7, GRAY);
  }

  // Gráfico KPI + inventario — igual que página informe
  const hist = data.historial ?? [];
  const histChart = data.historialChart ?? hist;
  const INV_COLOR = rgb(0.580, 0.635, 0.722); // #94a3b8 slate
  if (histChart.length >= 2) {
    const chartY = 370; const chartH = 230;
    const cX = M + 24; const cW = usable - 54; // 24px left para labels, 30px right
    const yearLabel = histChart[0]?.fecha?.slice(0, 4) ?? new Date().getFullYear();
    txt(p1, `KPI PRODUCTIVIDAD - AÑO ${yearLabel}`, cX, chartY + chartH + 10, fB, 7.5, DARK);

    const kpiVals  = histChart.map(r => r.productividad_drone       ?? null);
    const kpiPVals = histChart.map(r => r.productividad_pesometro   ?? null);
    const labels   = histChart.map(r => `${r.fecha.slice(5).replace("-","/")} ${r.hora.slice(0,5)}`);

    // Background + ejes
    rect(p1, cX, chartY, cW, chartH, LIGHT, rgb(0.88, 0.90, 0.92));
    line(p1, cX, chartY, cX, chartY + chartH, GRAY, 0.5);
    line(p1, cX, chartY, cX + cW, chartY, GRAY, 0.5);
    line(p1, cX + cW, chartY, cX + cW, chartY + chartH, GRAY, 0.5);

    // Eje Y izquierdo — t/h (KPI)
    const allVals = [...kpiVals, ...kpiPVals].filter((v): v is number => v !== null && isFinite(v));
    const minV = Math.max(0, Math.min(...allVals, 32) * 0.85);
    const maxV = Math.max(...allVals, 32) * 1.1;
    const range = maxV - minV || 1;
    txt(p1, "t/h", M, chartY + chartH + 3, fR, 6, GRAY);
    for (let i = 0; i <= 4; i++) {
      const gy = chartY + (i / 4) * chartH;
      line(p1, cX, gy, cX + cW, gy, rgb(0.90, 0.92, 0.94), 0.4);
      const val = fmtN(minV + (i / 4) * range, 0);
      const lw = fR.widthOfTextAtSize(val, 5.5);
      txt(p1, val, cX - 3 - lw, gy - 3, fR, 5.5, GRAY);
    }

    // Línea de control 32 t/h
    const refY = chartY + ((32 - minV) / range) * chartH;
    if (refY >= chartY && refY <= chartY + chartH) {
      line(p1, cX, refY, cX + cW, refY, RED, 0.8, [4, 3]);
      txt(p1, "Control 32 t/h", cX + cW - 56, refY + 2, fR, 5.5, RED);
    }

    // X labels — dd/MM + tick marks
    const shortLabels = histChart.map(r => r.fecha.slice(5).replace("-", "/"));
    const stepC = Math.max(1, Math.ceil(histChart.length / 8));
    shortLabels.forEach((l, i) => {
      if (i % stepC === 0 || i === histChart.length - 1) {
        const px = cX + (i / Math.max(histChart.length - 1, 1)) * cW;
        line(p1, px, chartY, px, chartY - 3, GRAY, 0.5);          // tick mark
        const lw = fR.widthOfTextAtSize(l, 5.5);
        txt(p1, l, px - lw / 2, chartY - 5, fR, 5.5, GRAY);      // centrado
      }
    });

    // Líneas KPI: drone (verde) + pesóm (gris oscuro — igual que informe)
    [[kpiVals, GREEN], [kpiPVals, DARK]].forEach(([vals, color]) => {
      const pts = (vals as (number | null)[]).map((v, i) => ({
        px: cX + (i / Math.max(histChart.length - 1, 1)) * cW,
        py: v !== null && isFinite(v) ? chartY + ((v - minV) / range) * chartH : null,
      }));
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]; const q = pts[i];
        if (p.py !== null && q.py !== null)
          line(p1, p.px, p.py, q.px, q.py, color as ReturnType<typeof rgb>, 1.5);
      }
      pts.forEach(p => { if (p.py !== null) p1.drawCircle({ x: p.px, y: p.py, size: 1.5, color: color as ReturnType<typeof rgb> }); });
    });

    // Inventario — eje secundario derecho (ton, línea punteada slate)
    const invVals = histChart.map(r => r.inventario_ton ?? null);
    const validInv = invVals.filter((v): v is number => v !== null && isFinite(v) && v > 0);
    if (validInv.length >= 2) {
      const minInv = Math.min(...validInv) * 0.90;
      const maxInv = Math.max(...validInv) * 1.10;
      const rangeInv = maxInv - minInv || 1;
      txt(p1, "ton", cX + cW + 3, chartY + chartH + 3, fR, 6, GRAY);
      for (let i = 0; i <= 3; i++) {
        const gy = chartY + (i / 3) * chartH;
        const val = fmtN(minInv + (i / 3) * rangeInv, 0);
        txt(p1, val, cX + cW + 3, gy - 3, fR, 5.5, GRAY);
      }
      const invPts = invVals.map((v, i) => ({
        px: cX + (i / Math.max(histChart.length - 1, 1)) * cW,
        py: v !== null && isFinite(v) && v > 0 ? chartY + ((v - minInv) / rangeInv) * chartH : null,
      }));
      for (let i = 1; i < invPts.length; i++) {
        const p = invPts[i - 1]; const q = invPts[i];
        if (p.py !== null && q.py !== null)
          line(p1, p.px, p.py, q.px, q.py, INV_COLOR, 1, [4, 3]);
      }
    }

    // Leyenda
    rect(p1, cX, chartY + chartH + 2, 8, 4, GREEN);
    txt(p1, "KPI Drone (t/h)", cX + 11, chartY + chartH + 2, fR, 6, DARK);
    rect(p1, cX + 92, chartY + chartH + 2, 8, 4, DARK);
    txt(p1, "KPI Pesometro (t/h)", cX + 103, chartY + chartH + 2, fR, 6, DARK);
    line(p1, cX + 208, chartY + chartH + 4, cX + 216, chartY + chartH + 4, INV_COLOR, 1, [4, 3]);
    txt(p1, "Inventario (ton, eje der.)", cX + 220, chartY + chartH + 2, fR, 6, GRAY);
  }

  // Tabla cubicación
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

  const hdrH = 14; const rowH = 17;
  const tblY1 = tblTop1 - 10;

  // Header
  rect(p1, M, tblY1 - hdrH, usable, hdrH, DARK);
  let cx = M + 3;
  cols1.forEach(c => {
    txt(p1, c.l.toUpperCase(), cx, tblY1 - hdrH + 4, fR, 5.5, WHITE);
    cx += c.w;
  });

  // Rows
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
      { v: `${r.fecha.split("-").reverse().join("/")} ${r.hora.slice(0,5)}`, r: false },
      { v: fmtN(kpiD),                                      r: true, color: kpiD >= 32 ? GREEN : RED },
      { v: fmtN(r.produccion_drone, 0),                     r: true },
      { v: fmtN(r.horas_reales),                            r: true },
      { v: fmtN(r.detencion),                               r: true, color: r.detencion > 0 ? RED : DARK },
      { v: fmtN(r.inventario_ton, 0),                       r: true },
      { v: r.cantidad_despachos ? String(r.cantidad_despachos) : "-", r: true },
      { v: fmtN(r.despachos_ton, 0),                        r: true },
      { v: fmtN(r.productividad_pesometro),                 r: true },
      { v: fmtN(r.produccion_pesometro ?? 0, 0),            r: true },
      { v: difStr,                                           r: true, color: difCol },
    ];

    cx = M + 3;
    cells.forEach((cell, ci) => {
      const col = cols1[ci];
      const xPos = cell.r
        ? M + cols1.slice(0, ci).reduce((a, c) => a + c.w, 0) + col.w - fR.widthOfTextAtSize(cell.v, 6.5) - 3
        : cx;
      txt(p1, cell.v, xPos, ry + 4.5, isCurr ? fB : fR, 6.5, cell.color ?? DARK);
      cx += col.w;
    });
  });

  pageFooter(p1, fR, W, M, 1);

  // ════════════════════════════════════════════════════════════════
  //  PAGINA 2 — POR SEMANA
  // ════════════════════════════════════════════════════════════════
  const p2 = pdfDoc.addPage([W, 842]);
  pageHeader(p2, fR, fB, W, M, "Por Semana", data.fecha, data.hora, data.usuario_email);

  // Variables para KPI cards página 2
  const gap = 7; const cw = (usable - 3 * gap) / 4; const ch = 60;

  const sem = data.semanalStats ?? [];
  const lastSem = sem[sem.length - 1];

  if (lastSem) {
    txt(p2, `SEMANA ACTUAL: ${lastSem.semana}`, M, 760, fB, 8.5, DARK);
    line(p2, M, 757, M + 120, 757, GREEN, 1.5);

    const semKpiD = lastSem.hrsProd > 0 ? lastSem.prodDrone / lastSem.hrsProd : 0;
    const semKpiP = lastSem.hrsProd > 0 ? lastSem.prodPeso  / lastSem.hrsProd : 0;
    const semDetPct = (lastSem.hrsProd + lastSem.detencion) > 0
      ? lastSem.detencion / (lastSem.hrsProd + lastSem.detencion) * 100 : 0;

    const sRow1 = [
      { l: "Productividad Drone", v: fmtN(semKpiD),              u: "t/h", a: semKpiD >= 32 ? GREEN : RED },
      { l: "Produccion Drone",    v: fmtN(lastSem.prodDrone, 0), u: "ton", a: DARK },
      { l: "Hrs Produccion",      v: fmtN(lastSem.hrsProd, 1),   u: "hrs", a: DARK },
      { l: "Detencion",           v: `${fmtN(lastSem.detencion, 1)} hrs`, u: `${fmtN(semDetPct, 0)}%`, a: lastSem.detencion > 0 ? RED : GREEN },
    ];
    const sRow2 = [
      { l: "Productividad Pesom.", v: fmtN(semKpiP),             u: "t/h", a: semKpiP >= 32 ? GREEN : RED },
      { l: "Produccion Pesom.",   v: fmtN(lastSem.prodPeso, 0),  u: "ton", a: BLUE },
      { l: "Despachos",           v: fmtN(lastSem.despachos, 0), u: "ton", a: DARK },
      { l: "Viajes",              v: String(lastSem.viajes),      u: "",    a: DARK },
    ];

    [sRow1, sRow2].forEach((row, ri) => {
      const cy = ri === 0 ? 684 : 684 - ch - gap;
      row.forEach((k, ci) => kpiCard(p2, fR, fB, M + ci * (cw + gap), cy, cw, ch, k.l, k.v, k.u, k.a));
    });
  }

  // Gráfico semanal — barras produccion (eje izq. ton) + líneas KPI (eje der. t/h)
  // Igual que página informe: ComposedChart con Bar + Line
  if (sem.length >= 2) {
    const chartY2 = 510; const chartH2 = 92;
    const cX2 = M + 24; const cW2 = usable - 54;
    const semYear = sem[0]?.semana?.slice(0, 4) ?? new Date().getFullYear();
    txt(p2, `PRODUCCION SEMANAL - AÑO ${semYear}`, cX2, chartY2 + chartH2 + 10, fB, 7.5, DARK);

    // Background + ejes
    rect(p2, cX2, chartY2, cW2, chartH2, LIGHT, rgb(0.88, 0.90, 0.92));
    line(p2, cX2, chartY2, cX2, chartY2 + chartH2, GRAY, 0.5);
    line(p2, cX2, chartY2, cX2 + cW2, chartY2, GRAY, 0.5);
    line(p2, cX2 + cW2, chartY2, cX2 + cW2, chartY2 + chartH2, GRAY, 0.5);

    // Eje Y izquierdo — ton (barras de producción)
    const allProd2 = sem.flatMap(s => [s.prodDrone, s.prodPeso]).filter(v => v > 0).sort((a, b) => a - b);
    const p95idx2  = Math.max(0, Math.floor(allProd2.length * 0.95) - 1);
    const maxP2    = allProd2.length > 0 ? Math.min(allProd2[allProd2.length - 1], allProd2[p95idx2] * 1.2) : 1;
    txt(p2, "ton", M, chartY2 + chartH2 + 3, fR, 6, GRAY);
    for (let gi = 0; gi <= 4; gi++) {
      const gy = chartY2 + (gi / 4) * chartH2;
      line(p2, cX2, gy, cX2 + cW2, gy, rgb(0.90, 0.92, 0.94), 0.4);
      const val = fmtN(maxP2 * gi / 4, 0);
      const lw = fR.widthOfTextAtSize(val, 5.5);
      txt(p2, val, cX2 - 3 - lw, gy - 3, fR, 5.5, GRAY);
    }

    // Eje Y derecho — t/h (líneas KPI)
    const allKpi2 = sem.map(s => s.hrsProd > 0 ? s.prodDrone / s.hrsProd : 0).filter(v => v > 0);
    const maxK2   = allKpi2.length > 0 ? Math.max(...allKpi2, 32) * 1.1 : 60;
    const minK2   = allKpi2.length > 0 ? Math.max(0, Math.min(...allKpi2) * 0.85) : 0;
    const rangeK2 = maxK2 - minK2 || 1;
    txt(p2, "t/h", cX2 + cW2 + 3, chartY2 + chartH2 + 3, fR, 6, GRAY);
    for (let ki = 0; ki <= 3; ki++) {
      const gy  = chartY2 + (ki / 3) * chartH2;
      const val = fmtN(minK2 + (ki / 3) * rangeK2, 0);
      txt(p2, val, cX2 + cW2 + 3, gy - 3, fR, 5.5, GRAY);
    }

    // Barras agrupadas: drone (verde) + pesóm (gris oscuro)
    const groupW2 = Math.max(11, Math.floor(cW2 / sem.length));
    const bw2     = Math.max(3,  Math.floor((groupW2 - 2) / 2));
    const startX2 = cX2 + Math.floor((cW2 - sem.length * groupW2) / 2);

    sem.forEach((s, i) => {
      const bhD = Math.max(0, (s.prodDrone / maxP2) * chartH2);
      const bhP = Math.max(0, (s.prodPeso  / maxP2) * chartH2);
      const bx  = startX2 + i * groupW2;
      if (bhD > 0) rect(p2, bx,          chartY2, bw2, bhD, GREEN);
      if (bhP > 0) rect(p2, bx + bw2 + 1, chartY2, bw2, bhP, DARK);
      if (i % Math.max(1, Math.ceil(sem.length / 10)) === 0 || i === sem.length - 1) {
        const label = s.semana.includes("-") ? s.semana.split("-")[1] : s.semana;
        const cx2lbl = bx + bw2;                                    // center of bar group
        line(p2, cx2lbl, chartY2, cx2lbl, chartY2 - 3, GRAY, 0.5); // tick mark
        const lw2 = fR.widthOfTextAtSize(label, 5.5);
        txt(p2, label, cx2lbl - lw2 / 2, chartY2 - 5, fR, 5.5, GRAY);
      }
    });

    // Líneas KPI sobre barras (eje derecho t/h)
    const centerOf2 = (i: number) => startX2 + i * groupW2 + bw2;
    type KpiPair = [(number | null)[], ReturnType<typeof rgb>];
    const kpiSeries: KpiPair[] = [
      [sem.map(s => s.hrsProd > 0 ? s.prodDrone / s.hrsProd : null), GREEN],
      [sem.map(s => s.hrsProd > 0 ? s.prodPeso  / s.hrsProd : null), DARK],
    ];
    kpiSeries.forEach(([vals, color]) => {
      const pts = vals.map((v, i) => ({
        px: centerOf2(i),
        py: v !== null && isFinite(v) ? chartY2 + ((v - minK2) / rangeK2) * chartH2 : null,
      }));
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]; const q = pts[i];
        if (p.py !== null && q.py !== null)
          line(p2, p.px, p.py, q.px, q.py, color, 1.5);
      }
      pts.forEach(p => { if (p.py !== null) p2.drawCircle({ x: p.px, y: p.py, size: 1.5, color }); });
    });

    // Referencia 32 t/h en eje KPI
    const refK2 = chartY2 + ((32 - minK2) / rangeK2) * chartH2;
    if (refK2 >= chartY2 && refK2 <= chartY2 + chartH2) {
      line(p2, cX2, refK2, cX2 + cW2, refK2, RED, 0.8, [4, 3]);
      txt(p2, "32 t/h", cX2 + cW2 - 24, refK2 + 2, fR, 5.5, RED);
    }

    // Leyenda
    rect(p2, cX2, chartY2 + chartH2 + 2, 8, 4, GREEN);
    txt(p2, "Prod. Drone", cX2 + 11, chartY2 + chartH2 + 2, fR, 6, DARK);
    rect(p2, cX2 + 72, chartY2 + chartH2 + 2, 8, 4, DARK);
    txt(p2, "Prod. Pesometro", cX2 + 83, chartY2 + chartH2 + 2, fR, 6, DARK);
    line(p2, cX2 + 172, chartY2 + chartH2 + 4, cX2 + 180, chartY2 + chartH2 + 4, GREEN, 1.5);
    txt(p2, "KPI Drone (eje der.)", cX2 + 184, chartY2 + chartH2 + 2, fR, 6, DARK);
    line(p2, cX2 + 278, chartY2 + chartH2 + 4, cX2 + 286, chartY2 + chartH2 + 4, DARK, 1.5);
    txt(p2, "KPI Pesometro (eje der.)", cX2 + 290, chartY2 + chartH2 + 2, fR, 6, DARK);
  }

  // ── Tabla resumen semanal ────────────────────────────────────────────────────
  const tblTop2 = 490;
  txt(p2, "RESUMEN SEMANAL - AÑO COMPLETO", M, tblTop2, fB, 7.5, DARK);
  line(p2, M, tblTop2 - 3, M + 145, tblTop2 - 3, GREEN, 1.2);

  const cols2 = [
    { l: "Semana",    w: 60,  r: false },
    { l: "KPI D.",    w: 47,  r: true  },
    { l: "Prod. D.",  w: 60,  r: true  },
    { l: "KPI P.",    w: 47,  r: true  },
    { l: "Prod. P.",  w: 60,  r: true  },
    { l: "Hrs Pr.",   w: 48,  r: true  },
    { l: "Deten.",    w: 48,  r: true  },
    { l: "Desp.",     w: 60,  r: true  },
    { l: "Viajes",    w: 39,  r: true  },
  ];

  const hdrH2 = 14; const rowH2 = 16;
  const tblY2 = tblTop2 - 10;

  // Header
  rect(p2, M, tblY2 - hdrH2, usable, hdrH2, DARK);
  let cx2 = M + 3;
  cols2.forEach(c => {
    txt(p2, c.l.toUpperCase(), cx2, tblY2 - hdrH2 + 4, fR, 5.5, WHITE);
    cx2 += c.w;
  });

  // Rows — mostrar todas las semanas, últimas primero
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
      { v: s.semana,              r: false },
      { v: fmtN(kpiD2),           r: true, color: kpiD2 >= 32 ? GREEN : RED },
      { v: fmtN(s.prodDrone, 0),  r: true },
      { v: fmtN(kpiP2),           r: true, color: kpiP2 >= 32 ? GREEN : RED },
      { v: fmtN(s.prodPeso, 0),   r: true },
      { v: fmtN(s.hrsProd, 1),    r: true },
      { v: fmtN(s.detencion, 1),  r: true, color: s.detencion > 0 ? RED : DARK },
      { v: fmtN(s.despachos, 0),  r: true },
      { v: String(s.viajes),      r: true },
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
