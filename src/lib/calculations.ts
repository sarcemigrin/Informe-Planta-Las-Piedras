/**
 * calculations.ts
 * Implementa las fórmulas del Excel de producción.
 * Extraídas de las columnas de "Datos Arena" y "Datos Cuarzo".
 */

// ---- Parámetros fijos ----
export const DENSIDAD_ARENA   = 1.4;   // ton/m3
export const DENSIDAD_CUARZO  = 1.65;  // ton/m3
export const FACTOR_PESOMETRO = 0.85;  // Corrección pesómetro (col F = E × 0.85)
export const FACTOR_CONOS     = 1.4;   // Densidad arena (usada también para conos)

// ---- Tipos de entrada ----
export interface ArenaInput {
  fecha:     string; // "YYYY-MM-DD"
  hora:      string; // "HH:mm"
  pesometro: number;
  horometro: number;
  fierrillo: number; // m3, col L
  cono_1: number;
  cono_2: number;
  cono_3: number;
  pila_1: number;
  pila_2: number;
  pila_3: number;
  pila_4: number;
  pila_5: number;
  pila_6: number;
  pila_7: number;
}

export interface CuarzoInput {
  fecha:     string;
  hora:      string;
  pesometro: number | null;
  horometro: number;
  cono_1: number;
  cono_2: number;
  cono_3: number;
}

export interface ArenaCalculated {
  fecha_hora:              string;
  diferencia_pesometro:    number;
  produccion_pesometro:    number;   // F = E × 0.85
  diferencia_horometro:    number;   // H
  horas_reales:            number;   // I = (FH_actual - FH_ant) × 24
  detencion:               number;   // J = I - H
  // Despachos (se calculan consultando la tabla despachos)
  despachos_ton:           number;   // M
  cantidad_despachos:      number;   // N
  // Inventario
  conos:                   number;   // AD = cono1+cono2+cono3
  acopio:                  number;   // AE = sum(pilas 1-4)
  inventario_m3:           number;   // AF = (conos + acopio + rinones)
  inventario_ton:          number;   // AG = AF × 1.4
  diferencia_inventario:   number;   // AH = AG - AG_ant + fierrillo×1.4
  // Producción
  produccion_drone:        number;   // AN = AH + despachos_ton
  productividad_drone:     number;   // AO = AN / H
  productividad_pesometro: number;   // AK = F / H
  productividad_hrs_reales:number;   // AP = AN / I
  diferencia:              number;   // AQ = 1 - AO/AK
  // Cancha
  cancha_vieja_ton:        number;   // AR = conos × 1.4
  cancha_nueva_ton:        number;   // AS = acopio × 1.4
  cancha_vieja_m3:         number;   // cono_1+cono_2+cono_3
  cancha_nueva_m3:         number;   // pila_1+pila_2+pila_3+pila_4
  rinones_m3:              number;   // pila_5+pila_6+pila_7
  rinones_ton:             number;   // rinones × 1.4
  // Acopios individuales en ton
  acopio_1_ton:            number;
  acopio_2_ton:            number;
  acopio_3_ton:            number;
  acopio_4_ton:            number;
  acopio_5_ton:            number;
  acopio_6_ton:            number;
  acopio_7_ton:            number;
  r1_ton:                  number;
  r2_ton:                  number;
  r3_ton:                  number;
}

export interface CuarzoCalculated {
  fecha_hora:              string;
  diferencia_pesometro:    number;
  produccion_pesometro:    number;
  diferencia_horometro:    number;
  horas_reales:            number;
  detencion:               number;
  despachos_ton:           number;
  cantidad_despachos:      number;
  conos:                   number;
  inventario_m3:           number;
  inventario_ton:          number;
  diferencia_inventario:   number;
  produccion_drone:        number;
  productividad_drone:     number;
  productividad_pesometro: number;
  productividad_hrs_reales:number;
  diferencia:              number;
}

// ---- Helper: construir Date desde fecha+hora ----
function toDate(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora}:00`);
}

// ====================================================
// CÁLCULOS ARENA
// ====================================================
export function calcularArena(
  current:           ArenaInput,
  previous:          ArenaInput & { inventario_ton: number } | null,
  despachosTon:      number,
  despachosViajes:   number,
): ArenaCalculated {
  const fechaHora = toDate(current.fecha, current.hora);

  // Sin registro anterior: primer droneo histórico
  if (!previous) {
    const conos   = (current.cono_1 || 0) + (current.cono_2 || 0) + (current.cono_3 || 0);
    const acopio  = sum([current.pila_1, current.pila_2, current.pila_3, current.pila_4]);
    const rinones = sum([current.pila_5, current.pila_6, current.pila_7]);
    const inv_m3  = conos + acopio + rinones;
    const inv_ton = inv_m3 * DENSIDAD_ARENA;
    return {
      fecha_hora:              fechaHora.toISOString(),
      diferencia_pesometro:    0,
      produccion_pesometro:    0,
      diferencia_horometro:    0,
      horas_reales:            0,
      detencion:               0,
      despachos_ton:           despachosTon,
      cantidad_despachos:      despachosViajes,
      conos,
      acopio,
      inventario_m3:           inv_m3,
      inventario_ton:          inv_ton,
      diferencia_inventario:   0,
      produccion_drone:        0,
      productividad_drone:     0,
      productividad_pesometro: 0,
      productividad_hrs_reales:0,
      diferencia:              0,
      cancha_vieja_ton:        conos   * DENSIDAD_ARENA,
      cancha_nueva_ton:        acopio  * DENSIDAD_ARENA,
      cancha_vieja_m3:         conos,
      cancha_nueva_m3:         acopio,
      rinones_m3:              rinones,
      rinones_ton:             rinones * DENSIDAD_ARENA,
      acopio_1_ton:            (current.cono_1 || 0) * DENSIDAD_ARENA,
      acopio_2_ton:            (current.cono_2 || 0) * DENSIDAD_ARENA,
      acopio_3_ton:            (current.cono_3 || 0) * DENSIDAD_ARENA,
      acopio_4_ton:            (current.pila_1 || 0) * DENSIDAD_ARENA,
      acopio_5_ton:            (current.pila_2 || 0) * DENSIDAD_ARENA,
      acopio_6_ton:            (current.pila_3 || 0) * DENSIDAD_ARENA,
      acopio_7_ton:            (current.pila_4 || 0) * DENSIDAD_ARENA,
      r1_ton:                  (current.pila_5 || 0) * DENSIDAD_ARENA,
      r2_ton:                  (current.pila_6 || 0) * DENSIDAD_ARENA,
      r3_ton:                  (current.pila_7 || 0) * DENSIDAD_ARENA,
    };
  }

  // ---- Col E: Diferencia Pesómetro ----
  const difPeso = current.pesometro - previous.pesometro;

  // ---- Col F: Producción Pesómetro ----
  const prodPeso = difPeso * FACTOR_PESOMETRO;

  // ---- Col H: Diferencia Horómetro ----
  const difHoro = current.horometro - previous.horometro;

  // ---- Col I: Horas Reales ----
  const prevFH  = toDate(previous.fecha, previous.hora);
  const horasReales = (fechaHora.getTime() - prevFH.getTime()) / (1000 * 60 * 60);

  // ---- Col J: Detención ----
  const detencion = Math.max(0, horasReales - difHoro);

  // ---- Cols AD, AE, AF, AG ----
  const conos   = (current.cono_1 || 0) + (current.cono_2 || 0) + (current.cono_3 || 0);
  const acopio  = sum([current.pila_1, current.pila_2, current.pila_3, current.pila_4]);
  const rinones = sum([current.pila_5, current.pila_6, current.pila_7]);
  const inv_m3  = conos + acopio + rinones;
  const inv_ton = inv_m3 * DENSIDAD_ARENA;

  // ---- Col AH: Diferencia Inventario ----
  // AH = AG_actual - AG_anterior + fierrillo×densidad
  const fierrilloTon = (current.fierrillo || 0) * DENSIDAD_ARENA;
  const difInv = inv_ton - previous.inventario_ton + fierrilloTon;

  // ---- Col AN: Producción Drone ----
  const prodDrone = difInv + despachosTon;

  // ---- Productividades ----
  const prodvDrone  = difHoro > 0 ? prodDrone  / difHoro : 0;
  const prodvPeso   = difHoro > 0 ? prodPeso   / difHoro : 0;
  const prodvReales = horasReales > 0 ? prodDrone / horasReales : 0;

  // ---- Col AQ: Diferencia relativa ----
  const diferencia = prodvPeso > 0 ? 1 - prodvDrone / prodvPeso : 0;

  return {
    fecha_hora:              fechaHora.toISOString(),
    diferencia_pesometro:    difPeso,
    produccion_pesometro:    prodPeso,
    diferencia_horometro:    difHoro,
    horas_reales:            horasReales,
    detencion,
    despachos_ton:           despachosTon,
    cantidad_despachos:      despachosViajes,
    conos,
    acopio,
    inventario_m3:           inv_m3,
    inventario_ton:          inv_ton,
    diferencia_inventario:   difInv,
    produccion_drone:        prodDrone,
    productividad_drone:     prodvDrone,
    productividad_pesometro: prodvPeso,
    productividad_hrs_reales:prodvReales,
    diferencia,
    cancha_vieja_ton:        conos   * DENSIDAD_ARENA,
    cancha_nueva_ton:        acopio  * DENSIDAD_ARENA,
    cancha_vieja_m3:         conos,
    cancha_nueva_m3:         acopio,
    rinones_m3:              rinones,
    rinones_ton:             rinones * DENSIDAD_ARENA,
    acopio_1_ton:            (current.cono_1 || 0) * DENSIDAD_ARENA,
    acopio_2_ton:            (current.cono_2 || 0) * DENSIDAD_ARENA,
    acopio_3_ton:            (current.cono_3 || 0) * DENSIDAD_ARENA,
    acopio_4_ton:            (current.pila_1 || 0) * DENSIDAD_ARENA,
    acopio_5_ton:            (current.pila_2 || 0) * DENSIDAD_ARENA,
    acopio_6_ton:            (current.pila_3 || 0) * DENSIDAD_ARENA,
    acopio_7_ton:            (current.pila_4 || 0) * DENSIDAD_ARENA,
    r1_ton:                  (current.pila_5 || 0) * DENSIDAD_ARENA,
    r2_ton:                  (current.pila_6 || 0) * DENSIDAD_ARENA,
    r3_ton:                  (current.pila_7 || 0) * DENSIDAD_ARENA,
  };
}

// ====================================================
// CÁLCULOS CUARZO
// ====================================================
export function calcularCuarzo(
  current:         CuarzoInput,
  previous:        CuarzoInput & { inventario_ton: number } | null,
  despachosTon:    number,
  despachosViajes: number,
): CuarzoCalculated {
  const fechaHora = toDate(current.fecha, current.hora);

  const conos    = (current.cono_1 || 0) + (current.cono_2 || 0) + (current.cono_3 || 0);
  const inv_m3   = conos;
  const inv_ton  = conos * DENSIDAD_CUARZO;

  if (!previous) {
    return {
      fecha_hora:              fechaHora.toISOString(),
      diferencia_pesometro:    0,
      produccion_pesometro:    0,
      diferencia_horometro:    0,
      horas_reales:            0,
      detencion:               0,
      despachos_ton:           despachosTon,
      cantidad_despachos:      despachosViajes,
      conos,
      inventario_m3:           inv_m3,
      inventario_ton:          inv_ton,
      diferencia_inventario:   0,
      produccion_drone:        0,
      productividad_drone:     0,
      productividad_pesometro: 0,
      productividad_hrs_reales:0,
      diferencia:              0,
    };
  }

  const difPeso   = (current.pesometro ?? 0) - (previous.pesometro ?? 0);
  const prodPeso  = difPeso * FACTOR_PESOMETRO;
  const difHoro   = current.horometro - previous.horometro;
  const prevFH    = toDate(previous.fecha, previous.hora);
  const horasReales = (fechaHora.getTime() - prevFH.getTime()) / (1000 * 60 * 60);
  const detencion = Math.max(0, horasReales - difHoro);  // Cuarzo: IF(I-H<0, 0, I-H)

  const difInv    = inv_ton - previous.inventario_ton;
  const prodDrone = difInv + despachosTon;

  const prodvDrone  = difHoro > 0 ? prodDrone / difHoro : 0;
  const prodvPeso   = difHoro > 0 ? prodPeso  / difHoro : 0;
  const prodvReales = horasReales > 0 ? prodDrone / horasReales : 0;
  const diferencia  = prodPeso > 0 ? 1 - prodDrone / prodPeso : 0;

  return {
    fecha_hora:              fechaHora.toISOString(),
    diferencia_pesometro:    difPeso,
    produccion_pesometro:    prodPeso,
    diferencia_horometro:    difHoro,
    horas_reales:            horasReales,
    detencion,
    despachos_ton:           despachosTon,
    cantidad_despachos:      despachosViajes,
    conos,
    inventario_m3:           inv_m3,
    inventario_ton:          inv_ton,
    diferencia_inventario:   difInv,
    produccion_drone:        prodDrone,
    productividad_drone:     prodvDrone,
    productividad_pesometro: prodvPeso,
    productividad_hrs_reales:prodvReales,
    diferencia,
  };
}

// ====================================================
// CÁLCULOS DIARIO
// Distribuye los valores del período entre los días
// ====================================================
export interface DiarioPeriodo {
  fechaDrone:         Date;
  fechaDroneAnterior: Date | null;
  despachosTon:       number;
  despachosViajes:    number;
  detencion:          number;
  prodPesometro:      number;
  prodDrone:          number;
  horasReales:        number;
  productividadPeso:  number;
  productividadDrone: number;
  productividadReales:number;
  fierrillo:          number;
  conos:              number;
}

export interface DiarioDia {
  fecha:                    Date;
  semana:                   number;
  mes:                      number;
  anio:                     number;
  esDroneoDay:              boolean;
  // totales (solo en días de droneo)
  despachos_ton_total:      number;
  viajes_total:             number;
  detencion_total:          number;
  produccion_pesometro_total: number;
  produccion_drone_total:   number;
  horas_reales_total:       number;
  fierrillo_total:          number;
  conos_total:              number;
  // promedios por día
  despachos_ton_dia:        number;
  viajes_dia:               number;
  detencion_dia:            number;
  produccion_pesometro_dia: number;
  produccion_drone_dia:     number;
  horas_reales_dia:         number;
  productividad_pesometro:  number;
  productividad_drone:      number;
  productividad_hrs_reales: number;
  fierrillo_dia:            number;
  conos_dia:                number;
}

export function calcularDiario(periodos: DiarioPeriodo[]): DiarioDia[] {
  const resultado: DiarioDia[] = [];

  for (const p of periodos) {
    if (!p.fechaDroneAnterior) continue; // primera medición sin anterior

    const diasPeriodo = Math.max(
      1,
      Math.round((p.fechaDrone.getTime() - p.fechaDroneAnterior.getTime()) / (1000 * 60 * 60 * 24))
    );

    // Generar todos los días del período (desde el día después del droneo anterior hasta el día del droneo actual inclusive)
    for (let i = 1; i <= diasPeriodo; i++) {
      const dia = new Date(p.fechaDroneAnterior);
      dia.setDate(dia.getDate() + i);
      const esDroneo = i === diasPeriodo;

      resultado.push({
        fecha:   dia,
        semana:  getWeek(dia),
        mes:     dia.getMonth() + 1,
        anio:    dia.getFullYear(),
        esDroneoDay: esDroneo,
        // totales
        despachos_ton_total:       esDroneo ? p.despachosTon : 0,
        viajes_total:              esDroneo ? p.despachosViajes : 0,
        detencion_total:           esDroneo ? p.detencion : 0,
        produccion_pesometro_total:esDroneo ? p.prodPesometro : 0,
        produccion_drone_total:    esDroneo ? p.prodDrone : 0,
        horas_reales_total:        esDroneo ? p.horasReales : 0,
        fierrillo_total:           esDroneo ? p.fierrillo : 0,
        conos_total:               esDroneo ? p.conos : 0,
        // promedios
        despachos_ton_dia:         p.despachosTon       / diasPeriodo,
        viajes_dia:                p.despachosViajes    / diasPeriodo,
        detencion_dia:             p.detencion          / diasPeriodo,
        produccion_pesometro_dia:  p.prodPesometro      / diasPeriodo,
        produccion_drone_dia:      p.prodDrone          / diasPeriodo,
        horas_reales_dia:          p.horasReales        / diasPeriodo,
        productividad_pesometro:   p.productividadPeso,
        productividad_drone:       p.productividadDrone,
        productividad_hrs_reales:  p.productividadReales,
        fierrillo_dia:             p.fierrillo          / diasPeriodo,
        conos_dia:                 p.conos              / diasPeriodo,
      });
    }
  }

  return resultado.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}

// ---- ISO week number ----
function getWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ---- Suma segura de array ----
function sum(values: (number | undefined | null)[]): number {
  return values.reduce<number>((acc, v) => acc + (v || 0), 0);
}

// ---- Formato número ----
export function fmt(n: number | null | undefined, decimales = 1): string {
  if (n == null || isNaN(n)) return "–";
  return n.toLocaleString("es-CL", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

// ---- Consultar despachos para un período ----
// Artículos: A36LGC = Arena, A37LGC = Cuarzo, A39LGC = A39
export const ARTICULO_ARENA   = "A36LGC";
export const ARTICULO_CUARZO  = "A37LGC";
export const ARTICULO_A39     = "A39LGC";
// Para producción de arena se suman A36LGC + A39LGC (igual que columna M del Excel)
export const ARTICULOS_ARENA_PROD = [ARTICULO_ARENA, ARTICULO_A39];
