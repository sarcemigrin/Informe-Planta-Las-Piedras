/**
 * POST /api/registros/recalcular
 * body: { tabla: "arena" | "cuarzo", registroId: string }
 *
 * Recalcula los campos derivados (inventario, producción, productividad) del
 * registro indicado y de TODOS los posteriores de esa planta, en orden — porque
 * cada registro usa el inventario_ton del anterior como punto de partida
 * (ver calcularArena/calcularCuarzo en lib/calculations.ts). Reutiliza esas
 * mismas funciones, no reimplementa fórmulas.
 *
 * Se usa después de editar un registro existente (EditArenaModal/EditCuarzoModal)
 * para que el cambio se propague correctamente hacia adelante en el tiempo.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";
import {
  calcularArena, calcularCuarzo, ARTICULOS_ARENA_PROD, ARTICULO_CUARZO,
  type ArenaInput, type CuarzoInput,
} from "@/lib/calculations";
import type { RegistroArena, RegistroCuarzo } from "@/types/database";

export const maxDuration = 60;

type Tabla = "arena" | "cuarzo";

function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Igual que arena/page.tsx y cuarzo/page.tsx — despachos guardados en hora local, no convertir a UTC
function addMinutes(localStr: string, minutes: number): string {
  const d = new Date(localStr.endsWith("Z") ? localStr : localStr + "Z");
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 19);
  d.setTime(d.getTime() + minutes * 60_000);
  return d.toISOString().slice(0, 19);
}

async function despachosEnVentana(
  sb: ReturnType<typeof getSupabaseServer>,
  tabla: Tabla,
  previousFH: string | null,
  currentFH: string,
): Promise<{ ton: number; viajes: number }> {
  if (!previousFH) return { ton: 0, viajes: 0 };

  if (tabla === "arena") {
    const { data } = await sb
      .from("despachos")
      .select("toneladas")
      .in("articulo", ARTICULOS_ARENA_PROD)
      .gte("fecha_hora", addMinutes(previousFH, 15))
      .lte("fecha_hora", addMinutes(currentFH, 15));
    const rows = (data ?? []) as { toneladas: number | null }[];
    return { ton: rows.reduce((s, d) => s + (d.toneladas ?? 0), 0), viajes: rows.length };
  }

  const { data } = await sb
    .from("despachos")
    .select("ton_final")
    .eq("articulo", ARTICULO_CUARZO)
    .gte("fecha_hora", addMinutes(previousFH, 15))
    .lte("fecha_hora", addMinutes(currentFH, 15));
  const rows = (data ?? []) as { ton_final: number | null }[];
  return { ton: rows.reduce((s, d) => s + (d.ton_final ?? 0), 0), viajes: rows.length };
}

function buildArenaInput(r: RegistroArena): ArenaInput {
  return {
    fecha: r.fecha, hora: r.hora.slice(0, 5),
    pesometro: r.pesometro, horometro: r.horometro, fierrillo: r.fierrillo,
    cono_1: r.cono_1, cono_2: r.cono_2, cono_3: r.cono_3,
    pila_1: r.pila_1, pila_2: r.pila_2, pila_3: r.pila_3, pila_4: r.pila_4,
    pila_5: r.pila_5, pila_6: r.pila_6, pila_7: r.pila_7,
  };
}

function buildCuarzoInput(r: RegistroCuarzo): CuarzoInput {
  return {
    fecha: r.fecha, hora: r.hora.slice(0, 5),
    pesometro: r.pesometro, horometro: r.horometro,
    cono_1: r.cono_1, cono_2: r.cono_2, cono_3: r.cono_3,
  };
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user)               return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.user.rol !== "admin") return NextResponse.json({ error: "Sin permisos" },   { status: 403 });

  let body: { tabla?: Tabla; registroId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { tabla, registroId } = body;
  if (tabla !== "arena" && tabla !== "cuarzo") {
    return NextResponse.json({ error: "tabla debe ser 'arena' o 'cuarzo'" }, { status: 400 });
  }
  if (!registroId) {
    return NextResponse.json({ error: "registroId requerido" }, { status: 400 });
  }

  const sb = getSupabaseServer();

  if (tabla === "arena") {
    const { data: rows, error: selError } = await sb
      .from("registros_arena").select("*").order("fecha_hora", { ascending: true });
    if (selError) return NextResponse.json({ error: selError.message }, { status: 500 });

    const list = (rows ?? []) as RegistroArena[];
    const startIdx = list.findIndex((r) => r.id === registroId);
    if (startIdx === -1) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

    let previous: (ArenaInput & { inventario_ton: number }) | null =
      startIdx > 0 ? { ...buildArenaInput(list[startIdx - 1]), inventario_ton: list[startIdx - 1].inventario_ton ?? 0 } : null;
    let previousFH: string | null = startIdx > 0 ? list[startIdx - 1].fecha_hora : null;

    let updated = 0;
    const errors: string[] = [];

    for (let i = startIdx; i < list.length; i++) {
      const row   = list[i];
      const input = buildArenaInput(row);
      const { ton, viajes } = await despachosEnVentana(sb, "arena", previousFH, row.fecha_hora);
      const calc = calcularArena(input, previous, ton, viajes);

      const { error: updError } = await sb.from("registros_arena").update({
        fecha_hora:               calc.fecha_hora,
        diferencia_pesometro:     calc.diferencia_pesometro,
        produccion_pesometro:     calc.produccion_pesometro,
        diferencia_horometro:     calc.diferencia_horometro,
        horas_reales:             calc.horas_reales,
        detencion:                calc.detencion,
        despachos_ton:            calc.despachos_ton,
        cantidad_despachos:       calc.cantidad_despachos,
        conos:                    calc.conos,
        acopio:                   calc.acopio,
        inventario_m3:            calc.inventario_m3,
        inventario_ton:           calc.inventario_ton,
        diferencia_inventario:    calc.diferencia_inventario,
        produccion_drone:         calc.produccion_drone,
        productividad_drone:      calc.productividad_drone,
        productividad_pesometro:  calc.productividad_pesometro,
        productividad_hrs_reales: calc.productividad_hrs_reales,
        diferencia:               calc.diferencia,
        cancha_vieja_ton:         calc.cancha_vieja_ton,
        cancha_nueva_ton:         calc.cancha_nueva_ton,
      }).eq("id", row.id);

      if (updError) errors.push(`${row.fecha} ${row.hora}: ${updError.message}`);
      else updated++;

      previous   = { ...input, inventario_ton: calc.inventario_ton };
      previousFH = row.fecha_hora;
    }

    return NextResponse.json({ updated, total: list.length - startIdx, errors: errors.length ? errors : undefined });
  }

  // tabla === "cuarzo"
  const { data: rows, error: selError } = await sb
    .from("registros_cuarzo").select("*").order("fecha_hora", { ascending: true });
  if (selError) return NextResponse.json({ error: selError.message }, { status: 500 });

  const list = (rows ?? []) as RegistroCuarzo[];
  const startIdx = list.findIndex((r) => r.id === registroId);
  if (startIdx === -1) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

  let previous: (CuarzoInput & { inventario_ton: number }) | null =
    startIdx > 0 ? { ...buildCuarzoInput(list[startIdx - 1]), inventario_ton: list[startIdx - 1].inventario_ton ?? 0 } : null;
  let previousFH: string | null = startIdx > 0 ? list[startIdx - 1].fecha_hora : null;

  let updated = 0;
  const errors: string[] = [];

  for (let i = startIdx; i < list.length; i++) {
    const row   = list[i];
    const input = buildCuarzoInput(row);
    const { ton, viajes } = await despachosEnVentana(sb, "cuarzo", previousFH, row.fecha_hora);
    const calc = calcularCuarzo(input, previous, ton, viajes);

    const { error: updError } = await sb.from("registros_cuarzo").update({
      fecha_hora:               calc.fecha_hora,
      diferencia_pesometro:     calc.diferencia_pesometro,
      produccion_pesometro:     calc.produccion_pesometro,
      diferencia_horometro:     calc.diferencia_horometro,
      horas_reales:             calc.horas_reales,
      detencion:                calc.detencion,
      despachos_ton:            calc.despachos_ton,
      cantidad_despachos:       calc.cantidad_despachos,
      conos:                    calc.conos,
      inventario_m3:            calc.inventario_m3,
      inventario_ton:           calc.inventario_ton,
      diferencia_inventario:    calc.diferencia_inventario,
      produccion_drone:         calc.produccion_drone,
      productividad_drone:      calc.productividad_drone,
      productividad_pesometro:  calc.productividad_pesometro,
      productividad_hrs_reales: calc.productividad_hrs_reales,
      diferencia:               calc.diferencia,
    }).eq("id", row.id);

    if (updError) errors.push(`${row.fecha} ${row.hora}: ${updError.message}`);
    else updated++;

    previous   = { ...input, inventario_ton: calc.inventario_ton };
    previousFH = row.fecha_hora;
  }

  return NextResponse.json({ updated, total: list.length - startIdx, errors: errors.length ? errors : undefined });
}
