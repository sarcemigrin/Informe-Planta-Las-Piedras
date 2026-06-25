/**
 * test-despachos.mjs
 * Prueba la lógica de query de despachos para un período dado.
 *
 * Ejecutar desde la carpeta arena-control:
 *   node test-despachos.mjs
 *
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// Leer .env.local manualmente (opcional — no falla si no existe)
function loadEnv() {
  try {
    const raw = readFileSync(".env.local", "utf-8");
    for (const line of raw.split("\n")) {
      const [k, ...v] = line.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    }
  } catch { /* no .env.local, se usarán args de línea de comandos */ }
}

// Intentar cargar .env.local; si no existe, usar args de línea de comandos
loadEnv();

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || process.argv[2];
const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.argv[3];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Faltan credenciales de Supabase.");
  console.error("   Opción 1: Crea .env.local con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY");
  console.error("   Opción 2: node test-despachos.mjs <SUPABASE_URL> <SUPABASE_ANON_KEY>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Parámetros del período a probar ────────────────────────────────────────
const PREV_FECHA = "2026-06-18";
const PREV_HORA  = "09:19";
const CURR_FECHA = "2026-06-19";
const CURR_HORA  = "08:38";

const ARTICULOS = ["A36LGC", "A39LGC"];
const MIN_TON_VIAJE = 25;

function addMinutes(str, minutes) {
  // Suma minutos a un string datetime local (sin conversión UTC)
  const d = new Date(str + (str.endsWith("Z") ? "" : "Z")); // forzar parseo sin offset
  return new Date(d.getTime() + minutes * 60_000)
    .toISOString()
    .slice(0, 19); // quitar la Z para mantener como string local
}

// ─── Construcción del rango — MODO APP (UTC) ─────────────────────────────────
const prevFH_utc = new Date(`${PREV_FECHA}T${PREV_HORA}:00`).toISOString();
const currFH_utc = new Date(`${CURR_FECHA}T${CURR_HORA}:00`).toISOString();
const desde_utc = addMinutes(prevFH_utc, 15) + "Z";
const hasta_utc = addMinutes(currFH_utc, 15) + "Z";

// ─── Construcción del rango — MODO LOCAL (hipótesis: despachos en hora local) ─
const prevFH_local = `${PREV_FECHA}T${PREV_HORA}:00`;
const currFH_local = `${CURR_FECHA}T${CURR_HORA}:00`;
const desde_local = addMinutes(prevFH_local, 15);
const hasta_local  = addMinutes(currFH_local, 15);

console.log("\n══════════════════════════════════════════════════════");
console.log("  TEST DESPACHOS — Comparativa UTC vs Local");
console.log("══════════════════════════════════════════════════════");
console.log(`  [UTC]   desde: ${desde_utc}  hasta: ${hasta_utc}`);
console.log(`  [LOCAL] desde: ${desde_local}  hasta: ${hasta_local}`);
console.log(`  Artículos: ${ARTICULOS.join(", ")}`);
console.log("──────────────────────────────────────────────────────\n");

async function run() {
  // ── Primero: ver columnas disponibles ────────────────────────────────────
  const { data: sample, error: errSample } = await supabase
    .from("despachos")
    .select("*")
    .limit(1);
  if (errSample) { console.error("Error leyendo columnas:", errSample); return; }
  if (sample && sample.length > 0) {
    console.log("📋 Columnas disponibles en 'despachos':");
    console.log("  ", Object.keys(sample[0]).join(", "));
  }
  console.log("");

  // ── Query LOCAL (hipótesis: despachos almacenados en hora local) ──────────
  const { data: dataLocal, error: errLocal } = await supabase
    .from("despachos")
    .select("fecha, hora, folio, articulo, toneladas, toneladas_confirmadas, ton_final")
    .in("articulo", ARTICULOS)
    .gte("fecha_hora", desde_local)
    .lte("fecha_hora", hasta_local)
    .order("fecha_hora", { ascending: true });

  if (errLocal) { console.error("Error query local:", errLocal); return; }

  const tonLocal = dataLocal.reduce((s, d) => s + (d.toneladas ?? 0), 0);
  const tonConfLocal = dataLocal.reduce((s, d) => s + (d.toneladas_confirmadas ?? 0), 0);
  const tonFinalLocal = dataLocal.reduce((s, d) => s + (d.ton_final ?? 0), 0);
  // Tonelada efectiva: confirmadas usa toneladas_confirmadas, no confirmadas usa toneladas
  const tonEfectiva = dataLocal.reduce((s, d) => {
    const tc = d.toneladas_confirmadas ?? 0;
    const t  = d.toneladas ?? 0;
    return s + (tc > 1 ? tc : t);  // si hay ton_conf real (>1), usarla
  }, 0);

  console.log(`🌎 QUERY LOCAL (sin conversión UTC): ${dataLocal.length} filas`);
  console.log(`   A36: ${dataLocal.filter(d=>d.articulo==="A36LGC").length} viajes`);
  console.log(`   A39: ${dataLocal.filter(d=>d.articulo==="A39LGC").length} viajes`);
  console.log(`   Total toneladas          : ${tonLocal.toFixed(2)} ton`);
  console.log(`   Total ton. confirmadas   : ${tonConfLocal.toFixed(2)} ton`);
  console.log(`   Total ton_final          : ${tonFinalLocal.toFixed(2)} ton`);
  console.log(`   Total ton efectiva*      : ${tonEfectiva.toFixed(2)} ton  (* conf>1→ton_conf, sino→toneladas)`);
  console.log("");

  // ── Query 1: Lógica ACTUAL de la app (UTC, toneladas > MIN_TON_VIAJE) ──────
  const { data: dataApp, error: errApp } = await supabase
    .from("despachos")
    .select("fecha, hora, folio, articulo, toneladas, toneladas_confirmadas, ton_final")
    .in("articulo", ARTICULOS)
    .gte("fecha_hora", desde_utc)
    .lte("fecha_hora", hasta_utc)
    .gt("toneladas", MIN_TON_VIAJE)
    .order("fecha_hora", { ascending: true });

  if (errApp) { console.error("Error query app:", errApp); return; }

  console.log(`📦 QUERY UTC con filtro (ton>${MIN_TON_VIAJE}): ${dataApp.length} filas`);
  console.log(`   A36: ${dataApp.filter(d => d.articulo === "A36LGC").length} viajes`);
  console.log(`   A39: ${dataApp.filter(d => d.articulo === "A39LGC").length} viajes`);
  const tonApp = dataApp.reduce((s, d) => s + (d.toneladas ?? 0), 0);
  console.log(`   Total toneladas : ${tonApp.toFixed(2)} ton`);

  // ── Query 2: UTC SIN filtro de MIN_TON_VIAJE ──────────────────────────────
  const { data: dataAll, error: errAll } = await supabase
    .from("despachos")
    .select("fecha, hora, folio, articulo, toneladas, toneladas_confirmadas, ton_final")
    .in("articulo", ARTICULOS)
    .gte("fecha_hora", desde_utc)
    .lte("fecha_hora", hasta_utc)
    .order("fecha_hora", { ascending: true });

  if (errAll) { console.error("Error query all:", errAll); return; }

  console.log(`\n📦 QUERY SIN FILTRO (todas las filas): ${dataAll.length} filas`);
  const tonAll  = dataAll.reduce((s, d) => s + (d.toneladas ?? 0), 0);
  const tonNeto = dataAll.reduce((s, d) => s + (d.ton_final  ?? 0), 0);
  console.log(`   Total toneladas : ${tonAll.toFixed(2)} ton`);
  console.log(`   Total ton_final : ${tonNeto.toFixed(2)} ton`);

  // ── Detalle completo ──────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────");
  console.log("  DETALLE POR VIAJE");
  console.log("──────────────────────────────────────────────────────");
  console.log(
    `${"Folio".padEnd(10)} ${"Fecha".padEnd(12)} ${"Hora".padEnd(8)} ${"Art".padEnd(8)} ${"Toneladas".padEnd(12)} TonFinal`
  );
  for (const d of dataAll) {
    const ton = (d.toneladas ?? 0).toFixed(3).padEnd(12);
    const tf  = (d.ton_final  ?? 0).toFixed(3);
    console.log(
      `${String(d.folio ?? "").padEnd(10)} ${(d.fecha ?? "").padEnd(12)} ${(d.hora ?? "").padEnd(8)} ${(d.articulo ?? "").padEnd(8)} ${ton} ${tf}`
    );
  }

  // ── Filas con toneladas ≤ 25 (las que filtra la app) — ahora con ton_conf ──
  const bajas = dataAll.filter(d => (d.toneladas ?? 0) <= MIN_TON_VIAJE);
  if (bajas.length > 0) {
    console.log(`\n⚠️  Filas UTC con toneladas ≤ ${MIN_TON_VIAJE} (excluidas por filtro):`);
    for (const d of bajas) {
      console.log(`   Folio ${d.folio} | ${d.fecha} ${d.hora} | ton=${d.toneladas} | ton_conf=${d.toneladas_confirmadas} | ton_final=${d.ton_final}`);
    }
  }

  // ── Detalle del query LOCAL ───────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────");
  console.log("  DETALLE LOCAL POR VIAJE");
  console.log("──────────────────────────────────────────────────────");
  console.log(
    `${"Folio".padEnd(10)} ${"Fecha".padEnd(12)} ${"Hora".padEnd(8)} ${"Art".padEnd(8)} ${"Ton".padEnd(10)} ${"TonConf".padEnd(10)} TonFinal`
  );
  for (const d of dataLocal) {
    const t  = (d.toneladas              ?? 0).toFixed(2).padEnd(10);
    const tc = (d.toneladas_confirmadas  ?? 0).toFixed(2).padEnd(10);
    const tf = (d.ton_final              ?? 0).toFixed(2);
    console.log(
      `${String(d.folio ?? "").padEnd(10)} ${(d.fecha ?? "").padEnd(12)} ${(d.hora ?? "").padEnd(8)} ${(d.articulo ?? "").padEnd(8)} ${t} ${tc} ${tf}`
    );
  }

  // ── Resumen de diferencias ────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  COMPARATIVA FINAL");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  Excel esperado           : ~616 ton / 35 viajes`);
  console.log(`  UTC con filtro ton>25    : ${tonApp.toFixed(2)} ton / ${dataApp.length} viajes`);
  console.log(`  UTC sin filtro (ton col) : ${tonAll.toFixed(2)} ton / ${dataAll.length} viajes`);
  console.log(`  UTC sin filtro (ton_fin) : ${tonNeto.toFixed(2)} ton / ${dataAll.length} viajes`);
  console.log(`  LOCAL sin filtro (ton)   : ${tonLocal.toFixed(2)} ton / ${dataLocal.length} viajes`);
  console.log(`  LOCAL ton efectiva*      : ${tonEfectiva.toFixed(2)} ton / ${dataLocal.length} viajes`);
  console.log(`  LOCAL ton_final          : ${tonFinalLocal.toFixed(2)} ton / ${dataLocal.length} viajes`);
  console.log("══════════════════════════════════════════════════════\n");
}

run().catch(console.error);
