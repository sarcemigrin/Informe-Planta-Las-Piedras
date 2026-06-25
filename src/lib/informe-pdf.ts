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

  // Sección title
  txt(p1, "REGISTRO ACTUAL", M, 760, fB, 8.5, DARK);
  line(p1, M, 757, M + 100, 757, GREEN, 1.5);

  // KPI cards 4+4
  const gap = 7; const cw = (usable - 3 * gap) / 4; const ch = 60;
  const detPct = (data.horas_reales + data.detencion) > 0
    ? data.detencion / (data.horas_reales + data.detencion) * 100 : 0;

  const row1 = [
    { l: "Productividad Drone",  v: fmtN(data.productividad_drone),     u: "t/h",
      a: data.productividad_drone  >= 32 ? GREEN : RED },
    { l: "Produccion Drone",     v: fmtN(data.produccion_drone, 0),     u: "ton",  a: DARK },
    { l: "Inventario",           v: fmtN(data.inventario_ton, 0),       u: "ton",
      a: data.inventario_ton >= 7500 ? GREEN : data.inventario_ton >= 6500 ? AMBER : RED },
    { l: "Despachos",            v: fmtN(data.despachos_ton, 0),        u: "ton",  a: DARK },
  ];
  const row2 = [
    { l: "Productividad Pesom.", v: fmtN(data.productividad_pesometro), u: "t/h",
      a: data.productividad_pesometro >= 32 ? GREEN : RED },
    { l: "Produccion Pesom.",    v: fmtN(data.diferencia_pesometro, 0), u: "ton",  a: BLUE },
    { l: "Horas Produccion",     v: fmtN(data.horas_reales),            u: "hrs",  a: DARK },
    { l: "Detencion",            v: `${fmtN(data.detencion)} hrs / ${fmtN(detPct, 0)}%`, u: "",
      a: data.detencion > 0 ? RED : GREEN },
  ];

  [row1, row2].forEach((row, ri) => {
    const cy = ri === 0 ? 684 : 684 - ch - gap;
    row.forEach((k, ci) => kpiCard(p1, fR, fB, M + ci * (cw + gap), cy, cw, ch, k.l, k.v, k.u, k.a));
  });

  // Sparkline productividad — año completo
  const hist = data.historial ?? [];
  const histChart = data.historialChart ?? hist; // usa historialChart si existe, sino los 10 del historial
  if (histChart.length >= 2) {
    const chartY = 370; const chartH = 230;
    const yearLabel = histChart[0]?.fecha?.slice(0, 4) ?? new Date().getFullYear();
    txt(p1, `PRODUCTIVIDAD DRONE/PESOMETRO - AÑO ${yearLabel}`, M, chartY + chartH + 10, fB, 7.5, DARK);

    const kpiVals  = histChart.map(r => r.productividad_drone ?? null);
    const kpiPVals = histChart.map(r => r.productividad_pesometro ?? null);
    const labels   = histChart.map(r => `${r.fecha.slice(5).replace("-","/")} ${r.hora.slice(0,5)}`);

    // Draw background
    rect(p1, M, chartY, usable, chartH, LIGHT, rgb(0.88, 0.90, 0.92));

    // Y axis labels
    const allVals = [...kpiVals, ...kpiPVals].filter((v): v is number => v !== null && isFinite(v));
    const minV = Math.min(...allVals, 32) * 0.9;
    const maxV = Math.max(...allVals, 32) * 1.1;
    const range = maxV - minV || 1;
    for (let i = 0; i <= 4; i++) {
      const gy = chartY + (i / 4) * chartH;
      line(p1, M, gy, M + usable, gy, rgb(0.90, 0.92, 0.94));
      txt(p1, fmtN(minV + (i / 4) * range, 0), M - 22, gy - 3, fR, 6, GRAY);
    }

    // Reference line 32
    const refY = chartY + ((32 - minV) / range) * chartH;
    if (refY >= chartY && refY <= chartY + chartH) {
      line(p1, M, refY, M + usable, refY, RED, 0.8, [4, 3]);
      txt(p1, "Control 32", M + usable - 40, refY + 2, fR, 6, RED);
    }

    // X labels
    const stepC = Math.ceil(histChart.length / 8);
    labels.forEach((l, i) => {
      if (i % stepC === 0 || i === histChart.length - 1) {
        const px = M + (i / Math.max(histChart.length - 1, 1)) * usable;
        txt(p1, l, px - 10, chartY - 9, fR, 5.5, GRAY);
      }
    });

    // Lines
    [[kpiVals, GREEN], [kpiPVals, BLUE]].forEach(([vals, color]) => {
      const pts = (vals as (number | null)[]).map((v, i) => ({
        px: M + (i / Math.max(histChart.length - 1, 1)) * usable,
        py: v !== null && isFinite(v) ? chartY + ((v - minV) / range) * chartH : null,
      }));
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]; const q = pts[i];
        if (p.py !== null && q.py !== null)
          line(p1, p.px, p.py, q.px, q.py, color as ReturnType<typeof rgb>, 1.5);
      }
      pts.forEach(p => { if (p.py !== null) p1.drawCircle({ x: p.px, y: p.py, size: 1.5, color: color as ReturnType<typeof rgb> }); });
    });

    // Legend
    rect(p1, M, chartY + chartH + 2, 8, 4, GREEN);
    txt(p1, "Drone", M + 11, chartY + chartH + 2, fR, 6, DARK);
    rect(p1, M + 45, chartY + chartH + 2, 8, 4, BLUE);
    txt(p1, "Pesometro", M + 56, chartY + chartH + 2, fR, 6, DARK);
    txt(p1, "t/h", M + usable, chartY + chartH + 2, fR, 6, GRAY);
  }

  // Tabla cubicación
  const tblTop1 = 345;
  txt(p1, `ULTIMOS ${hist.length} REGISTROS DE CUBICACION`, M, tblTop1, fB, 7.5, DARK);
  line(p1, M, tblTop1 - 3, M + 130, tblTop1 - 3, GREEN, 1.2);

  const cols1 = [
    { l: "Fecha / Hora",    w: 93, r: false },
    { l: "Prod. Drone",     w: 67, r: true  },
    { l: "Kpi Drone t/h",  w: 67, r: true  },
    { l: "Kpi Pesom. t/h", w: 67, r: true  },
    { l: "Hrs Prod.",       w: 57, r: true  },
    { l: "Detencion",       w: 57, r: true  },
    { l: "Inventario",      w: 72, r: true  },
    { l: "Viajes",          w: 59, r: true  },
  ];

  const hdrH = 14; const rowH = 19;
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
    if (ry < 45) return; // No salir de la página
    rect(p1, M, ry, usable, rowH, i % 2 === 0 ? WHITE : STRIPE);
    const isCurr = r.fecha === data.fecha && r.hora.startsWith(data.hora.slice(0, 5));
    if (isCurr) rect(p1, M, ry, 3, rowH, GREEN);

    const kpiD = r.horas_reales > 0 ? r.produccion_drone / r.horas_reales : 0;
    const cells = [
      { v: `${r.fecha.split("-").reverse().join("/")} ${r.hora.slice(0,5)}`, r: false },
      { v: fmtN(r.produccion_drone, 0), r: true },
      { v: fmtN(kpiD),                 r: true, color: kpiD >= 32 ? GREEN : RED },
      { v: fmtN(r.productividad_pesometro), r: true },
      { v: fmtN(r.horas_reales),        r: true },
      { v: fmtN(r.detencion),           r: true, color: r.detencion > 0 ? RED : DARK },
      { v: fmtN(r.inventario_ton, 0),   r: true },
      { v: r.cantidad_despachos ? String(r.cantidad_despachos) : "-", r: true },
    ];

    cx = M + 3;
    cells.forEach((cell, ci) => {
      const col = cols1[ci];
      const _color = cell.color ?? DARK;
      const xPos = cell.r
        ? M + cols1.slice(0, ci).reduce((a, c) => a + c.w, 0) + col.w - fR.widthOfTextAtSize(cell.v, 7.5) - 3
        : cx;
      txt(p1, cell.v, xPos, ry + 5.5, isCurr ? fB : fR, 7.5, cell.color ?? DARK);
      cx += col.w;
    });
  });

  pageFooter(p1, fR, W, M, 1);

  // ════════════════════════════════════════════════════════════════
  //  PAGINA 2 — POR SEMANA
  // ════════════════════════════════════════════════════════════════
  const p2 = pdfDoc.addPage([W, 842]);
  pageHeader(p2, fR, fB, W, M, "Por Semana", data.fecha, data.hora, data.usuario_email);

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

  // Bar chart semanal (produccion año completo)
  if (sem.length >= 2) {
    const chartY2 = 517; const chartH2 = 80;
    const semYear = sem[0]?.semana?.slice(0, 4) ?? new Date().getFullYear();
    txt(p2, `PRODUCCION SEMANAL (ton) - AÑO ${semYear}`, M, chartY2 + chartH2 + 10, fB, 7.5, DARK);
    rect(p2, M, chartY2, usable, chartH2, LIGHT, rgb(0.88, 0.90, 0.92));

    // Usar solo valores positivos para la escala
    const validProd = sem.map(s => s.prodDrone).filter(v => v > 0);
    const maxP = validProd.length > 0 ? Math.max(...validProd) : 1;

    // Y-axis gridlines con labels
    for (let gi = 1; gi <= 4; gi++) {
      const gy = chartY2 + (gi / 4) * chartH2;
      line(p2, M, gy, M + usable, gy, rgb(0.88, 0.90, 0.93));
      if (gi < 4) txt(p2, fmtN(maxP * gi / 4, 0), M - 24, gy - 3, fR, 5.5, GRAY);
    }
    txt(p2, fmtN(maxP, 0), M - 24, chartY2 + chartH2 - 3, fR, 5.5, GRAY);

    // Barras: grupo por semana, ancho calculado para llenar el área
    const groupW = Math.max(13, Math.floor(usable / sem.length));
    const bw = Math.max(3, Math.floor((groupW - 3) / 2));
    const startX = M + Math.floor((usable - sem.length * groupW) / 2);

    sem.forEach((s, i) => {
      const bh  = Math.max(0, (s.prodDrone / maxP) * chartH2);
      const bh2 = Math.max(0, (s.prodPeso  / maxP) * chartH2);
      const bx  = startX + i * groupW;
      if (bh > 0)  rect(p2, bx,          chartY2, bw, bh,  GREEN);
      if (bh2 > 0) rect(p2, bx + bw + 2, chartY2, bw, bh2, BLUE);
      if (i % Math.ceil(sem.length / 8) === 0 || i === sem.length - 1) {
        const label = s.semana.includes("-") ? s.semana.split("-")[1] : s.semana;
        txt(p2, label, bx + bw / 2 - 4, chartY2 - 9, fR, 5.5, GRAY);
      }
    });

    // Legend (sin línea KPI — confusa con eje secundario)
    rect(p2, M, chartY2 + chartH2 + 2, 8, 4, GREEN);
    txt(p2, "Prod. Drone (ton)", M + 11, chartY2 + chartH2 + 2, fR, 6, DARK);
    rect(p2, M + 90, chartY2 + chartH2 + 2, 8, 4, BLUE);
    txt(p2, "Prod. Pesometro (ton)", M + 101, chartY2 + chartH2 + 2, fR, 6, DARK);
  }

  // Tabla semanal
  const tblTop2 = 497;
  const rowH2 = 14; // filas más compactas para caber el año completo
  txt(p2, `SEMANAS AÑO ${sem[0]?.semana?.slice(0, 4) ?? new Date().getFullYear()} (${sem.length} semanas)`, M, tblTop2, fB, 7.5, DARK);
  line(p2, M, tblTop2 - 3, M + 120, tblTop2 - 3, GREEN, 1.2);

  const cols2 = [
    { l: "Semana",          w: 73,  r: false },
    { l: "Prod. Drone",     w: 66,  r: true  },
    { l: "Kpi Drone t/h",  w: 62,  r: true  },
    { l: "Prod. Pesom.",    w: 66,  r: true  },
    { l: "Kpi Pesom. t/h", w: 62,  r: true  },
    { l: "Hrs Prod.",       w: 52,  r: true  },
    { l: "Detencion",       w: 52,  r: true  },
    { l: "Despachos",       w: 62,  r: true  },
    { l: "Viajes",          w: 44,  r: true  },
  ];

  const tblY2 = tblTop2 - 10;
  rect(p2, M, tblY2 - hdrH, usable, hdrH, DARK);
  cx = M + 3;
  cols2.forEach(c => {
    txt(p2, c.l.toUpperCase(), cx, tblY2 - hdrH + 4, fR, 5.5, WHITE);
    cx += c.w;
  });

  const dispSem = [...sem].reverse();
  dispSem.forEach((s, i) => {
    const ry = tblY2 - hdrH - (i + 1) * rowH2;
    if (ry < 45) return;
    rect(p2, M, ry, usable, rowH2, i % 2 === 0 ? WHITE : STRIPE);
    const kD = s.hrsProd > 0 ? s.prodDrone / s.hrsProd : 0;
    const kP = s.hrsProd > 0 ? s.prodPeso  / s.hrsProd : 0;
    const isLast = i === 0;
    if (isLast) rect(p2, M, ry, 3, rowH2, GREEN);

    const cells2 = [
      { v: s.semana,                r: false },
      { v: fmtN(s.prodDrone, 0),    r: true  },
      { v: fmtN(kD),                r: true, color: kD >= 32 ? GREEN : RED },
      { v: fmtN(s.prodPeso, 0),     r: true  },
      { v: fmtN(kP),                r: true, color: kP >= 32 ? GREEN : RED },
      { v: fmtN(s.hrsProd, 1),      r: true  },
      { v: fmtN(s.detencion, 1),    r: true, color: s.detencion > 0 ? RED : DARK },
      { v: fmtN(s.despachos, 0),    r: true  },
      { v: String(s.viajes),        r: true  },
    ];

    cx = M + 3;
    cells2.forEach((cell, ci) => {
      const col = cols2[ci];
      const xPos = cell.r
        ? M + cols2.slice(0, ci).reduce((a, c) => a + c.w, 0) + col.w - fR.widthOfTextAtSize(cell.v, 6.5) - 3
        : cx;
      txt(p2, cell.v, xPos, ry + 4, isLast ? fB : fR, 6.5, cell.color ?? DARK);
      cx += col.w;
    });
  });

  pageFooter(p2, fR, W, M, 2);

  return pdfDoc.save();
}
