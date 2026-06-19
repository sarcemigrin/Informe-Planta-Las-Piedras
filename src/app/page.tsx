"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena, RegistroCuarzo } from "@/types/database";
import {
  ComposedChart, LineChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { format, differenceInDays, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { es } from "date-fns/locale";

// ── Productividad: umbrales y colores ─────────────────────
const PROD_TARGET = 32;
const PROD_CRIT   = PROD_TARGET * 0.90; // 28.8 t/h

const DENSIDAD = 1.4;
const MESES    = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Paleta profesional compatible con migrin green
const YR_COLORS = ["#6BCF7F","#0ea5e9","#f59e0b","#8b5cf6","#f43f5e"];

function prodText(v?: number | null) {
  if (!v || v === 0) return "text-gray-600";
  if (v >= PROD_TARGET) return "text-green-600";
  if (v >= PROD_CRIT)   return "text-yellow-500";
  return "text-red-500";
}
function prodBg(v?: number | null) {
  if (!v || v === 0) return "bg-gray-50";
  if (v >= PROD_TARGET) return "bg-green-50";
  if (v >= PROD_CRIT)   return "bg-yellow-50";
  return "bg-red-50";
}
function prodHex(v?: number | null) {
  if (!v || v === 0) return "#9ca3af";
  if (v >= PROD_TARGET) return "#22c55e";
  if (v >= PROD_CRIT)   return "#eab308";
  return "#ef4444";
}

// ── Dashboard ──────────────────────────────────────────────
export default function Dashboard() {
  const [arenaRows,      setArenaRows]      = useState<RegistroArena[]>([]);
  const [arenaHistorico, setArenaHistorico] = useState<Pick<RegistroArena,"fecha"|"produccion_drone"|"productividad_drone">[]>([]);
  const [cuarzoRows,     setCuarzoRows]     = useState<RegistroCuarzo[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [selectedIdx,    setSelectedIdx]    = useState(0);
  const [periodoComp,    setPeriodoComp]    = useState<"S1"|"S2"|"anual">("anual");
  const [selectedYears,  setSelectedYears]  = useState<number[]>([]);
  const [showYrFilter,   setShowYrFilter]   = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: arena }, { data: cuarzo }, { data: historico }] = await Promise.all([
        supabase.from("registros_arena").select("*").order("fecha_hora",{ascending:false}).limit(30),
        supabase.from("registros_cuarzo").select("*").order("fecha_hora",{ascending:false}).limit(5),
        supabase.from("registros_arena")
          .select("fecha,produccion_drone,productividad_drone")
          .order("fecha_hora",{ascending:true})
          .gte("fecha","2023-01-01"),
      ]);
      setArenaRows(arena ?? []);
      setCuarzoRows(cuarzo ?? []);
      setArenaHistorico((historico ?? []) as Pick<RegistroArena,"fecha"|"produccion_drone"|"productividad_drone">[]);
      setLoading(false);
    }
    load();
  }, []);

  const sel          = arenaRows[selectedIdx];
  const prev         = arenaRows[selectedIdx + 1];
  const ultimoCuarzo = cuarzoRows[0];
  const diasDesde    = sel ? differenceInDays(new Date(), new Date(sel.fecha)) : null;

  // Tendencia semanal
  const now       = new Date();
  const startThis = startOfWeek(now,{weekStartsOn:1});
  const startLast = startOfWeek(subWeeks(now,1),{weekStartsOn:1});
  const endLast   = endOfWeek(subWeeks(now,1),{weekStartsOn:1});
  const thisWk    = arenaRows.filter(r => new Date(r.fecha) >= startThis);
  const lastWk    = arenaRows.filter(r => { const d=new Date(r.fecha); return d>=startLast&&d<=endLast; });
  const avgThis   = thisWk.length ? thisWk.reduce((s,r)=>s+(r.produccion_drone??0),0)/thisWk.length : 0;
  const avgLast   = lastWk.length ? lastWk.reduce((s,r)=>s+(r.produccion_drone??0),0)/lastWk.length : 0;
  const tendencia = avgLast > 0 ? ((avgThis-avgLast)/avgLast)*100 : null;

  // Chart productividad (últimas 15)
  const chartData = useMemo(() =>
    [...arenaRows].reverse().slice(-15).map(r => ({
      fecha:     format(new Date(r.fecha),"dd/MM",{locale:es}),
      prodDrone: r.productividad_drone,
      prodPeso:  r.productividad_pesometro,
    }))
  , [arenaRows]);

  // Comparativa anual
  const { compChart, allYears, currentYear } = useMemo(() => {
    const cy = new Date().getFullYear();
    const meses = periodoComp==="S1"?[0,1,2,3,4,5]:periodoComp==="S2"?[6,7,8,9,10,11]:[0,1,2,3,4,5,6,7,8,9,10,11];
    const byYM: Record<number,Record<number,{ton:number[];prod:number[]}>> = {};
    arenaHistorico.forEach(r => {
      const d=new Date(r.fecha), y=d.getFullYear(), m=d.getMonth();
      if(!meses.includes(m)) return;
      if(!byYM[y]) byYM[y]={};
      if(!byYM[y][m]) byYM[y][m]={ton:[],prod:[]};
      byYM[y][m].ton.push(r.produccion_drone ?? 0);
      byYM[y][m].prod.push(r.productividad_drone ?? 0);
    });
    const ys = Object.keys(byYM).map(Number).sort();
    const data = meses.map(m => {
      const row: Record<string,unknown> = { mes: MESES[m] };
      ys.forEach(y => {
        const d = byYM[y]?.[m];
        row[`ton_${y}`]  = d?.ton.length  ? d.ton.reduce((a,b)=>a+b,0)             : null;
        row[`prod_${y}`] = d?.prod.length ? d.prod.reduce((a,b)=>a+b,0)/d.prod.length : null;
      });
      return row;
    });
    return { compChart: data, allYears: ys, currentYear: cy };
  }, [arenaHistorico, periodoComp]);

  // Init selected years once allYears loads
  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears(allYears);
    }
  }, [allYears]);

  const visibleYears = allYears.filter(y => selectedYears.includes(y));

  function trend(cur?:number|null,prv?:number|null){ if(!cur||!prv||prv===0) return null; return ((cur-prv)/prv)*100; }

  // Acopios
  const conosTon = [(sel?.cono_1??0),(sel?.cono_2??0),(sel?.cono_3??0)].map(v=>v*DENSIDAD);
  const pilasTon = [(sel?.pila_1??0),(sel?.pila_2??0),(sel?.pila_3??0),(sel?.pila_4??0),(sel?.pila_5??0),(sel?.pila_6??0),(sel?.pila_7??0)].map(v=>v*DENSIDAD);
  const canchaViejaTon = conosTon.reduce((a,b)=>a+b,0);
  const canchaNuevaTon = pilasTon.slice(0,4).reduce((a,b)=>a+b,0);
  const riñonesTon     = pilasTon.slice(4).reduce((a,b)=>a+b,0);

  if(loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Planta Las Piedras – Producción Arena &amp; Cuarzo</p>
        </div>
        <div className="flex gap-2">
          <Link href="/arena"  className="btn-primary">+ Arena</Link>
          <Link href="/cuarzo" className="btn-secondary">+ Cuarzo</Link>
        </div>
      </div>

      {/* ── Arena KPIs ── */}
      <section>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">⛏ Arena</h2>
          <select
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 font-medium focus:outline-none focus:ring-1 focus:ring-migrin"
            value={selectedIdx}
            onChange={e=>setSelectedIdx(Number(e.target.value))}
          >
            {arenaRows.map((r,i)=>(
              <option key={r.id} value={i}>
                {i===0?"★ ":""}{format(new Date(r.fecha),"dd/MM/yyyy")} {r.hora?.slice(0,5)}
              </option>
            ))}
          </select>
          {diasDesde!==null&&(
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              diasDesde===0?"bg-green-100 text-green-700":diasDesde<=2?"bg-yellow-100 text-yellow-700":"bg-red-100 text-red-600"
            }`}>{diasDesde===0?"Hoy":`Hace ${diasDesde}d`}</span>
          )}
          {selectedIdx===0&&tendencia!==null&&(
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tendencia>=0?"bg-green-50 text-green-700":"bg-red-50 text-red-600"}`}>
              {tendencia>=0?"↑":"↓"} {Math.abs(tendencia).toFixed(1)}% sem.
            </span>
          )}
        </div>
        {/* Orden: Productividad → Prod.Drone → Inventario → Despachos → Prod.Pesóm. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Productividad" value={fmt(sel?.productividad_drone)}     unit="ton/h" color="prod"   icon="⚡"
            info="Toneladas producidas por hora de horómetro. Meta: ≥32 t/h · Amarillo: 28.8–32 (dentro del 10%) · Rojo: <28.8 t/h."
            trend={trend(sel?.productividad_drone, prev?.productividad_drone)} prodVal={sel?.productividad_drone}/>
          <KpiCard label="Prod. Drone"   value={fmt(sel?.produccion_drone)}        unit="ton"   color="green"  icon="🚁"
            info="Producción por diferencia de inventario entre droneos consecutivos + despachos del período."
            trend={trend(sel?.produccion_drone, prev?.produccion_drone)}/>
          <KpiCard label="Inventario"    value={fmt(sel?.inventario_ton)}           unit="ton"   color="blue"   icon="📦"
            info="Suma de acopios Cancha Vieja + Cancha Nueva × densidad 1.4 ton/m³. Refleja el stock total disponible en cancha al momento del droneo."
            trend={trend(sel?.inventario_ton, prev?.inventario_ton)}/>
          <KpiCard label="Despachos"     value={fmt(sel?.despachos_ton)}            unit="ton"   color="gray"   icon="🚛"
            info="Total toneladas despachadas entre el droneo anterior y este, según datos SAP."
            trend={trend(sel?.despachos_ton, prev?.despachos_ton)}/>
          <KpiCard label="Prod. Pesóm."  value={fmt(sel?.produccion_pesometro)}    unit="ton"   color="migrin" icon="⚖️"
            info="Producción según diferencia de lecturas del pesómetro × factor de humedad 0.85. Referencia complementaria al cálculo por drone."
            trend={trend(sel?.produccion_pesometro, prev?.produccion_pesometro)}/>
        </div>
      </section>

      {/* ── Cuarzo + Canchas ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">🪨 Cuarzo &amp; Canchas Arena</h2>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">

          {/* Cuarzo inventario */}
          <KpiCard label="Inv. Cuarzo" value={fmt(ultimoCuarzo?.inventario_ton)} unit="ton" color="blue" icon="🪨"
            info={`Inventario cuarzo al ${ultimoCuarzo?format(new Date(ultimoCuarzo.fecha),"dd/MM/yyyy"):"–"}. Calculado como volumen de conos × 1.65 ton/m³.`}/>

          {/* Cancha Vieja */}
          <div className="card space-y-2 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancha Vieja</span>
              <span className="text-sm font-bold text-gray-800">{fmt(canchaViejaTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {["Cono 1","Cono 2","Cono 3"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                  <p className="text-xs text-gray-400">{lbl}</p>
                  <p className="text-sm font-semibold text-gray-700">{fmt(conosTon[n],0)}</p>
                  <p className="text-xs text-gray-400">ton</p>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text="Volumen de los 3 conos medidos por drone × 1.4 ton/m³. Corresponde al stock apilado en cancha histórica."/>
            </div>
          </div>

          {/* Cancha Nueva */}
          <div className="card space-y-2 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancha Nueva</span>
              <span className="text-sm font-bold text-gray-800">{fmt(canchaNuevaTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {["Pila 1","Pila 2","Pila 3","Pila 4"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-1 py-1.5 text-center">
                  <p className="text-xs text-gray-400">{lbl}</p>
                  <p className="text-sm font-semibold text-gray-700">{fmt(pilasTon[n],0)}</p>
                  <p className="text-xs text-gray-400">ton</p>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text="Volumen de los 4 acopios principales (pilas 1–4) medidos por drone × 1.4 ton/m³."/>
            </div>
          </div>

          {/* Riñones */}
          <div className="card space-y-2 relative">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Riñones</span>
            <p className="text-2xl font-bold text-gray-800">{fmt(riñonesTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></p>
            <div className="grid grid-cols-3 gap-1">
              {["P5","P6","P7"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-1 py-1.5 text-center">
                  <p className="text-xs text-gray-400">{lbl}</p>
                  <p className="text-xs font-semibold text-gray-700">{fmt(pilasTon[n+4],0)}</p>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text="Acopios pequeños consolidados (pilas 5–7). Material acumulado en zonas secundarias de la cancha."/>
            </div>
          </div>
        </div>
      </section>

      {/* ── Gráfico 1: Productividad ── */}
      {chartData.length > 0 && (
        <section className="card">
          <div className="mb-3">
            <h2 className="font-semibold text-gray-800">Productividad Arena — últimas {chartData.length} mediciones</h2>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
              <span><span className="text-green-600 font-bold">●</span> ≥32 t/h (meta)</span>
              <span><span className="text-yellow-500 font-bold">●</span> 28.8–32 t/h</span>
              <span><span className="text-red-500 font-bold">●</span> &lt;28.8 t/h</span>
              <span className="text-migrin font-semibold">— Drone &nbsp; <span className="text-gray-400">- - Pesóm.</span></span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{top:24,right:16,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="fecha" tick={{fontSize:10}} tickLine={false}/>
              <YAxis tick={{fontSize:10}} width={48} domain={["auto","auto"]} tickLine={false}
                tickFormatter={v=>`${v}`}/>
              <Tooltip
                formatter={(v,n)=>[`${fmt(v as number)} t/h`, n==="prodDrone"?"Productiv. Drone":"Productiv. Pesóm."]}
                contentStyle={{fontSize:12,borderRadius:10,border:"1px solid #e5e7eb",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}
              />
              {/* Línea de control meta 32 t/h */}
              <ReferenceLine y={32} stroke="#6BCF7F" strokeDasharray="6 3" strokeWidth={1.5}
                label={{value:"32 t/h", position:"insideTopRight", fontSize:10, fill:"#6BCF7F", fontWeight:"600"}}/>
              {/* Línea Drone */}
              <Line type="monotone" dataKey="prodDrone" name="prodDrone" strokeWidth={2.5}
                stroke="#6BCF7F" dot={false} activeDot={{r:6}}
                label={(props:Record<string,unknown>)=>{
                  const {x,y,index,value}=props as {x:number;y:number;index:number;value:number|null};
                  if(value==null) return <text key={`e-${index}`}/>;
                  const isLast = index===chartData.length-1;
                  // Alternar arriba/abajo para evitar solapamiento
                  const offset = index % 2 === 0 ? -14 : 16;
                  if(isLast) return (
                    <text key="last-d" x={x as number} y={(y as number)+offset} textAnchor="middle"
                      fontSize={11} fontWeight="bold" fill={prodHex(value)}>{fmt(value,1)}</text>
                  );
                  if(index % 4 === 0) return (
                    <text key={`lbl-${index}`} x={x as number} y={(y as number)+offset} textAnchor="middle"
                      fontSize={9} fill="#b0b8c4">{fmt(value,1)}</text>
                  );
                  return <text key={`e-${index}`}/>;
                }}
              />
              {/* Puntos Drone separados para control de color */}
              <Line type="monotone" dataKey="prodDrone" name="_dotsDrone" strokeWidth={0} legendType="none"
                dot={(props:Record<string,unknown>)=>{
                  const {cx,cy,index,value}=props as {cx:number;cy:number;index:number;value:number};
                  const isLast = index===chartData.length-1;
                  return <circle key={`dd-${index}`} cx={cx} cy={cy} r={isLast?7:4}
                    fill={prodHex(value)} stroke="#fff" strokeWidth={isLast?2:1.5}/>;
                }}
                activeDot={false}
              />
              {/* Línea Pesómetro */}
              <Line type="monotone" dataKey="prodPeso" name="prodPeso" strokeWidth={1.5} strokeDasharray="5 4"
                stroke="#94a3b8"
                dot={(props:Record<string,unknown>)=>{
                  const {cx,cy,index,value}=props as {cx:number;cy:number;index:number;value:number};
                  const isLast = index===chartData.length-1;
                  return <circle key={`dp-${index}`} cx={cx} cy={cy} r={isLast?5:3}
                    fill={prodHex(value)} stroke="#fff" strokeWidth={1}/>;
                }}
                activeDot={{r:5}}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Gráfico 2: Comparativa Anual ── */}
      {compChart.length > 0 && allYears.length > 0 && (
        <section className="card">
          {/* Controles */}
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-800 text-sm sm:text-base">Comparativa Anual — Producción &amp; Productividad</h2>
              <p className="text-xs text-gray-400 mt-0.5 hidden sm:block">Barras: producción total mes · Línea: productividad promedio</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Selector periodo */}
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {([["S1","S1"],["S2","S2"],["anual","Año"]] as const).map(([v,label])=>(
                  <button key={v} onClick={()=>setPeriodoComp(v)}
                    className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                    style={periodoComp===v?{backgroundColor:"#6BCF7F",color:"#fff"}:{color:"#6b7280"}}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Toggle año filter */}
              <button onClick={()=>setShowYrFilter(v=>!v)}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 font-medium hover:border-migrin transition-colors flex items-center gap-1">
                Años {showYrFilter?"▲":"▼"}
              </button>
            </div>
          </div>

          {/* Panel años (colapsable) */}
          {showYrFilter && (
            <div className="mb-3 p-2 bg-gray-50 rounded-lg flex flex-wrap gap-2">
              {allYears.map((y,i)=>(
                <label key={y} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox"
                    checked={selectedYears.includes(y)}
                    onChange={()=>setSelectedYears(prev=>
                      prev.includes(y) ? prev.filter(x=>x!==y) : [...prev,y]
                    )}
                    className="rounded"
                    style={{accentColor: YR_COLORS[i % YR_COLORS.length]}}
                  />
                  <span className="text-xs font-semibold" style={{color: YR_COLORS[i % YR_COLORS.length]}}>
                    {y}{y===currentYear?" (actual)":""}
                  </span>
                </label>
              ))}
            </div>
          )}

          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={compChart} margin={{top:5,right:44,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="mes" tick={{fontSize:10}} tickLine={false}/>
              <YAxis yAxisId="ton"  orientation="left"  tick={{fontSize:9}} width={52} tickLine={false}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}/>
              <YAxis yAxisId="prod" orientation="right" tick={{fontSize:9}} width={36} tickLine={false}
                tickFormatter={v=>`${v}`}/>
              <Tooltip
                formatter={(v,n)=>{
                  const s=String(n);
                  if(s.startsWith("ton_"))  return [`${fmt(v as number,0)} ton`,  `Producción ${s.slice(4)}`];
                  if(s.startsWith("prod_")) return [`${fmt(v as number,1)} t/h`,  `Productividad ${s.slice(5)}`];
                  return [v,n];
                }}
                contentStyle={{fontSize:11,borderRadius:10,border:"1px solid #e5e7eb",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}
              />
              <Legend
                wrapperStyle={{fontSize:10,paddingTop:8}}
                formatter={n=>{
                  const s=String(n);
                  if(s.startsWith("ton_"))  return `Prod. ${s.slice(4)}`;
                  if(s.startsWith("prod_")) return `Productiv. ${s.slice(5)}`;
                  return n;
                }}
              />
              {visibleYears.map((y,i)=>{
                const ci = allYears.indexOf(y);
                return (
                  <Bar key={`ton_${y}`} yAxisId="ton" dataKey={`ton_${y}`} name={`ton_${y}`}
                    fill={YR_COLORS[ci%YR_COLORS.length]}
                    opacity={y===currentYear?0.85:0.5}
                    radius={[3,3,0,0]}/>
                );
              })}
              {visibleYears.map((y)=>{
                const ci = allYears.indexOf(y);
                return (
                  <Line key={`prod_${y}`} yAxisId="prod" dataKey={`prod_${y}`} name={`prod_${y}`}
                    stroke={YR_COLORS[ci%YR_COLORS.length]}
                    strokeWidth={y===currentYear?2.5:1.5}
                    dot={{r:3}} connectNulls
                    strokeDasharray={y===currentYear?"0":"5 3"}/>
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Tabla ── */}
      <section className="card overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Registros Arena recientes</h2>
          <Link href="/informe" className="text-sm font-medium hover:underline" style={{color:"#6BCF7F"}}>Ver informe →</Link>
        </div>
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Productividad</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Inventario</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Prod. Pesóm.</th>
              <th className="table-th">Productiv. Pesóm.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {arenaRows.slice(0,8).map((r,i)=>(
              <tr key={r.id}
                className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedIdx===i?"bg-green-50/40 ring-1 ring-inset ring-migrin/30":""}`}
                onClick={()=>setSelectedIdx(i)}>
                <td className="table-td-left">
                  <div className="font-medium">{format(new Date(r.fecha),"dd/MM/yyyy")} {r.hora.slice(0,5)}</div>
                  {i===0
                    ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">último</span>
                    : <span className="text-xs text-gray-300">hace {differenceInDays(new Date(),new Date(r.fecha))}d</span>
                  }
                </td>
                <td className={`table-td font-bold ${prodText(r.productividad_drone)}`}>
                  {fmt(r.productividad_drone)} t/h
                </td>
                <td className="table-td text-green-700 font-semibold">{fmt(r.produccion_drone)}</td>
                <td className="table-td text-blue-700">{fmt(r.inventario_ton)}</td>
                <td className="table-td">{fmt(r.despachos_ton)}</td>
                <td className="table-td text-migrin">{fmt(r.produccion_pesometro)}</td>
                <td className={`table-td ${prodText(r.productividad_pesometro)}`}>{fmt(r.productividad_pesometro)} t/h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">💡 Haz clic en una fila para ver sus KPIs arriba</p>
      </section>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────

function KpiInfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        className="w-4 h-4 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 hover:text-gray-700 text-xs flex items-center justify-center font-bold leading-none select-none"
        onMouseEnter={()=>setShow(true)}
        onMouseLeave={()=>setShow(false)}
        onTouchStart={()=>setShow(v=>!v)}
        onClick={e=>e.stopPropagation()}
      >i</button>
      {show && (
        <div className="absolute bottom-6 right-0 z-50 w-52 bg-gray-800 text-white text-xs rounded-xl px-3 py-2 shadow-xl leading-relaxed whitespace-normal pointer-events-none">
          {text}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, unit, color, icon, trend: trendVal, info, prodVal }: {
  label:string; value:string; unit:string; color:string; icon:string;
  trend?:number|null; info?:string; prodVal?:number|null;
}) {
  const isProd = color === "prod";
  const colorClass = isProd ? prodText(prodVal) : ({
    blue:"text-blue-600", green:"text-green-600", migrin:"text-migrin",
    purple:"text-purple-600", gray:"text-gray-700", yellow:"text-yellow-600",
  }[color]??"text-gray-900");
  const bgClass = isProd ? prodBg(prodVal) : ({
    blue:"bg-blue-50", green:"bg-green-50", migrin:"bg-green-50",
    purple:"bg-purple-50", gray:"bg-gray-50", yellow:"bg-yellow-50",
  }[color]??"bg-gray-50");

  return (
    <div className={`stat-card relative pb-6 ${bgClass} border border-transparent hover:border-gray-200 transition-colors`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-base">{icon}</span>
        {trendVal!=null&&(
          <span className={`text-xs font-bold ${trendVal>=0?"text-green-600":"text-red-500"}`}>
            {trendVal>=0?"↑":"↓"} {Math.abs(trendVal).toFixed(1)}%
          </span>
        )}
      </div>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${colorClass}`}>{value}</span>
      <span className="text-xs text-gray-400">{unit}</span>
      {info && (
        <div className="absolute bottom-2 right-2">
          <KpiInfoTooltip text={info}/>
        </div>
      )}
    </div>
  );
}
