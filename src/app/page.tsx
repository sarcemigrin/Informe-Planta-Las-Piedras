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

type ArenaHistRow = Pick<RegistroArena,
  "fecha"|"produccion_drone"|"productividad_drone"|"horas_reales"|
  "cono_1"|"cono_2"|"cono_3"|"pila_1"|"pila_2"|"pila_3"|"pila_4"|"pila_5"|"pila_6"|"pila_7">;

// Productividad
const PROD_TARGET = 32;
const PROD_CRIT   = PROD_TARGET * 0.90;

// Inventario
const INV_TARGET = 7500;
const INV_WARN   = 6500;

const DENSIDAD        = 1.4;
const DENSIDAD_CUARZO = 1.65;
const CAP_CANCHA_NUEVA = 16150;
const CAP_RINONES      = 1500;
const CAP_CUARZO       = 5360;
const MESES    = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const YR_COLORS = ["#6BCF7F","#0ea5e9","#f59e0b","#8b5cf6","#f43f5e"];

function pd(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00");
}

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
function invText(v?: number | null) {
  if (!v || v === 0) return "text-gray-600";
  if (v >= INV_TARGET) return "text-green-600";
  if (v >= INV_WARN)   return "text-yellow-500";
  return "text-red-500";
}
function invBg(v?: number | null) {
  if (!v || v === 0) return "bg-gray-50";
  if (v >= INV_TARGET) return "bg-green-50";
  if (v >= INV_WARN)   return "bg-yellow-50";
  return "bg-red-50";
}

export default function Dashboard() {
  const [arenaRows,      setArenaRows]      = useState<RegistroArena[]>([]);
  const [arenaHistorico, setArenaHistorico] = useState<ArenaHistRow[]>([]);
  const [cuarzoRows,     setCuarzoRows]     = useState<RegistroCuarzo[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [selectedIdx,    setSelectedIdx]    = useState(0);
  const [periodoComp,    setPeriodoComp]    = useState<"S1"|"S2"|"anual">("anual");
  const [selectedYears,  setSelectedYears]  = useState<number[]>([]);
  const [showYrFilter,   setShowYrFilter]   = useState(false);
  const [vistaComp,      setVistaComp]      = useState<"ambas"|"produccion"|"productividad">("ambas");

  useEffect(() => {
    async function load() {
      const [{ data: arena }, { data: cuarzo }, { data: historico }] = await Promise.all([
        supabase.from("registros_arena").select("*").order("fecha_hora",{ascending:false}).limit(30),
        supabase.from("registros_cuarzo").select("*").order("fecha_hora",{ascending:false}).limit(20),
        supabase.from("registros_arena")
          .select("fecha,produccion_drone,productividad_drone,horas_reales,cono_1,cono_2,cono_3,pila_1,pila_2,pila_3,pila_4,pila_5,pila_6,pila_7")
          .order("fecha_hora",{ascending:true})
          .gte("fecha","2023-01-01"),
      ]);
      setArenaRows(arena ?? []);
      setCuarzoRows(cuarzo ?? []);
      setArenaHistorico((historico ?? []) as ArenaHistRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const sel          = arenaRows[selectedIdx];
  const prev         = arenaRows[selectedIdx + 1];
  const ultimoCuarzo = cuarzoRows[0];
  const diasDesde    = sel ? differenceInDays(new Date(), pd(sel.fecha)) : null;

  const now       = new Date();
  const startThis = startOfWeek(now,{weekStartsOn:1});
  const startLast = startOfWeek(subWeeks(now,1),{weekStartsOn:1});
  const endLast   = endOfWeek(subWeeks(now,1),{weekStartsOn:1});
  const thisWk    = arenaRows.filter(r => pd(r.fecha) >= startThis);
  const lastWk    = arenaRows.filter(r => { const d=pd(r.fecha); return d>=startLast&&d<=endLast; });
  const avgThis   = thisWk.length ? thisWk.reduce((s,r)=>s+(r.produccion_drone??0),0)/thisWk.length : 0;
  const avgLast   = lastWk.length ? lastWk.reduce((s,r)=>s+(r.produccion_drone??0),0)/lastWk.length : 0;
  const tendencia = avgLast > 0 ? ((avgThis-avgLast)/avgLast)*100 : null;

  const chartData = useMemo(() =>
    [...arenaRows].reverse().slice(-15).map(r => ({
      fecha:     format(pd(r.fecha),"dd/MM",{locale:es}),
      prodDrone: r.productividad_drone,
      prodPeso:  r.productividad_pesometro,
    }))
  , [arenaRows]);

  const { compChart, allYears, currentYear } = useMemo(() => {
    const cy = new Date().getFullYear();
    const meses = periodoComp==="S1"?[0,1,2,3,4,5]:periodoComp==="S2"?[6,7,8,9,10,11]:[0,1,2,3,4,5,6,7,8,9,10,11];
    // Agrupar por año-mes: sumar producción y horas → productividad = Σton / Σhrs
    const byYM: Record<number,Record<number,{ton:number; hrs:number}>> = {};
    arenaHistorico.forEach(r => {
      const d = pd(r.fecha), y = d.getFullYear(), m = d.getMonth();
      if (!meses.includes(m)) return;
      if (!byYM[y]) byYM[y] = {};
      if (!byYM[y][m]) byYM[y][m] = { ton: 0, hrs: 0 };
      byYM[y][m].ton += r.produccion_drone ?? 0;
      byYM[y][m].hrs += r.horas_reales    ?? 0;
    });
    const ys = Object.keys(byYM).map(Number).sort();
    const data = meses.map(m => {
      const row: Record<string,unknown> = { mes: MESES[m] };
      ys.forEach(y => {
        const d = byYM[y]?.[m];
        row["ton_"  + y] = d && d.ton > 0 ? d.ton : null;
        row["prod_" + y] = d && d.ton > 0 && d.hrs > 0 ? d.ton / d.hrs : null;
      });
      return row;
    });
    return { compChart: data, allYears: ys, currentYear: cy };
  }, [arenaHistorico, periodoComp]);

  const maxCanchas = useMemo(() => {
    let vieja = 0;
    arenaHistorico.forEach(r => {
      const v = ((r.cono_1??0)+(r.cono_2??0)+(r.cono_3??0))*DENSIDAD;
      if (v > vieja) vieja = v;
    });
    return { vieja };
  }, [arenaHistorico]);

  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) setSelectedYears(allYears);
  }, [allYears]);

  const visibleYears = allYears.filter(y => selectedYears.includes(y));

  function trend(cur?:number|null,prv?:number|null){
    if(!cur||!prv||prv===0) return null;
    return ((cur-prv)/prv)*100;
  }

  const conosTon      = [(sel?.cono_1??0),(sel?.cono_2??0),(sel?.cono_3??0)].map(v=>v*DENSIDAD);
  const cuarzoConosTon = [(ultimoCuarzo?.cono_1??0),(ultimoCuarzo?.cono_2??0),(ultimoCuarzo?.cono_3??0)].map(v=>v*DENSIDAD_CUARZO);
  const cuarzoTotalTon = cuarzoConosTon.reduce((a,b)=>a+b,0);
  const pilasTon = [(sel?.pila_1??0),(sel?.pila_2??0),(sel?.pila_3??0),(sel?.pila_4??0),(sel?.pila_5??0),(sel?.pila_6??0),(sel?.pila_7??0)].map(v=>v*DENSIDAD);
  const canchaViejaTon = conosTon.reduce((a,b)=>a+b,0);
  const canchaNuevaTon = pilasTon.slice(0,4).reduce((a,b)=>a+b,0);
  const rinoesTon      = pilasTon.slice(4).reduce((a,b)=>a+b,0);

  if(loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Control de inventarios y productividad - Planta de Arenas</p>
        </div>
        <div className="flex gap-2">
          <Link href="/arena"  className="btn-primary">+ Arena</Link>
          <Link href="/cuarzo" className="btn-secondary">+ Cuarzo</Link>
        </div>
      </div>

      {/* Arena KPIs */}
      <section>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Arena</h2>
          <select
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 font-medium focus:outline-none focus:ring-1 focus:ring-migrin"
            value={selectedIdx}
            onChange={e=>setSelectedIdx(Number(e.target.value))}
          >
            {arenaRows.map((r,i)=>(
              <option key={r.id} value={i}>
                {i===0?"* ":""}{format(pd(r.fecha),"dd/MM/yyyy")} {r.hora?.slice(0,5)}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Productividad Drone" value={fmt(sel?.productividad_drone)}  unit="ton/h" color="prod"   icon=""
            info="Toneladas producidas por hora de horometro. Meta: >=32 t/h · Amarillo: 28.8-32 (dentro del 10%) · Rojo: <28.8 t/h."
            trend={trend(sel?.productividad_drone, prev?.productividad_drone)} prodVal={sel?.productividad_drone}/>
          <KpiCard label="Producción Drone"    value={fmt(sel?.produccion_drone)}     unit="ton"   color="green"  icon=""
            info="Produccion por diferencia de inventario entre droneos consecutivos + despachos del periodo."
            trend={trend(sel?.produccion_drone, prev?.produccion_drone)}/>
          <KpiCard label="Inventario Arena"    value={fmt(sel?.inventario_ton)}       unit="ton"   color="inv"    icon=""
            info="Suma de acopios Cancha Vieja + Cancha Nueva x densidad 1.4 ton/m3. Meta de control: 7.500 ton · Amarillo: 6.500-7.500 · Rojo: <6.500 ton."
            trend={trend(sel?.inventario_ton, prev?.inventario_ton)} invVal={sel?.inventario_ton}/>
          <KpiCard label="Productividad Pesom." value={fmt(sel?.productividad_pesometro)} unit="ton/h" color="migrin" icon=""
            info="Productividad segun pesometro (t/h). Referencia complementaria al calculo por drone."
            trend={trend(sel?.productividad_pesometro, prev?.productividad_pesometro)}/>
          <KpiCard label="Producción Pesom."   value={fmt(sel?.produccion_pesometro)} unit="ton"   color="migrin" icon=""
            info="Produccion segun diferencia de lecturas del pesometro x factor de humedad 0.85. Referencia complementaria al calculo por drone."
            trend={trend(sel?.produccion_pesometro, prev?.produccion_pesometro)}/>
        </div>
      </section>

      {/* Cuarzo + Canchas */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Canchas Arena &amp; Cuarzo</h2>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">

          {/* Cancha Vieja */}
          <div className="card space-y-3 relative pb-8 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancha Vieja</span>
              <span className="text-lg font-bold text-gray-800">{fmt(canchaViejaTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
            </div>
            {maxCanchas.vieja > 0 && <CapacityBar current={canchaViejaTon} max={maxCanchas.vieja}/>}
            <div className="grid grid-cols-3 gap-2">
              {["Acopio 1","Acopio 2","Acopio 3"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-2 py-2.5 text-center">
                  <p className="text-xs text-gray-400 mb-1">{lbl}</p>
                  <p className="text-base font-bold text-gray-700">{fmt(conosTon[n],0)}</p>
                  <p className="text-xs text-gray-400">ton</p>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text="Desglose de los acopios en Cancha Vieja: 3 acopios medidos por drone x 1.4 ton/m3."/>
            </div>
          </div>

          {/* Cancha Nueva */}
          <div className="card space-y-3 relative pb-8 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancha Nueva</span>
              <span className="text-lg font-bold text-gray-800">{fmt(canchaNuevaTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
            </div>
            <CapacityBar current={canchaNuevaTon} max={CAP_CANCHA_NUEVA}/>
            <div className="grid grid-cols-4 gap-2">
              {["Acopio 4","Acopio 5","Acopio 6","Acopio 7"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-1 py-2.5 text-center">
                  <p className="text-xs text-gray-400 mb-1">{lbl}</p>
                  <p className="text-base font-bold text-gray-700">{fmt(pilasTon[n],0)}</p>
                  <p className="text-xs text-gray-400">ton</p>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text="Desglose de los acopios en Cancha Nueva: 4 acopios medidos por drone x 1.4 ton/m3."/>
            </div>
          </div>

          {/* Rinones */}
          <div className="card space-y-3 relative pb-8 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Riñones</span>
              <span className="text-lg font-bold text-gray-800">{fmt(rinoesTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
            </div>
            <CapacityBar current={rinoesTon} max={CAP_RINONES}/>
            <div className="grid grid-cols-3 gap-2">
              {["R1","R2","R3"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-2 py-2.5 text-center">
                  <p className="text-xs text-gray-400 mb-1">{lbl}</p>
                  <p className="text-base font-bold text-gray-700">{fmt(pilasTon[n+4],0)}</p>
                  <p className="text-xs text-gray-400">ton</p>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text="Desglose de acopios Riñones (R1, R2, R3): material acumulado en zonas secundarias de la cancha x 1.4 ton/m3."/>
            </div>
          </div>

          {/* Cuarzo */}
          <div className="card space-y-3 relative pb-8 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cuarzo</span>
              <span className="text-lg font-bold text-blue-700">{fmt(cuarzoTotalTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
            </div>
            {ultimoCuarzo && <CapacityBar current={cuarzoTotalTon} max={CAP_CUARZO}/>}
            <CuarzoSparkline rows={cuarzoRows}/>
            <div className="absolute bottom-2 right-2">
              <KpiInfoTooltip text={`Inventario cuarzo al ${ultimoCuarzo?format(new Date(ultimoCuarzo.fecha),"dd/MM/yyyy"):"--"}. Conos x 1.65 ton/m3. Capacidad máx: ${fmt(CAP_CUARZO,0)} ton.`}/>
            </div>
          </div>
        </div>
      </section>

      {/* Grafico 1: Productividad */}
      {chartData.length > 0 && (
        <section className="card">
          <div className="mb-3">
            <h2 className="font-semibold text-gray-800">Productividad Arena</h2>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
              <span><span className="text-green-600 font-bold">o</span> &gt;=32 t/h</span>
              <span><span className="text-yellow-500 font-bold">o</span> 28.8-32 t/h</span>
              <span><span className="text-red-500 font-bold">o</span> &lt;28.8 t/h</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{top:8,right:16,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="fecha" tick={{fontSize:10}} tickLine={false}/>
              <YAxis tick={{fontSize:10}} width={48} domain={["auto","auto"]} tickLine={false}/>
              <Tooltip
                formatter={(v,n)=>[`${fmt(v as number,1)} t/h`, n==="prodDrone"?"Productiv. Drone":n==="prodPeso"?"Productiv. Pesom.":"Meta"]}
                contentStyle={{fontSize:12,borderRadius:10,border:"1px solid #e5e7eb",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}
              />
              <Legend formatter={n=>{
                if(n==="prodDrone") return "Productiv. Drone";
                if(n==="prodPeso")  return "Productiv. Pesom.";
                if(n==="metaRef")   return "Meta 32 t/h";
                return n;
              }}/>
              <ReferenceLine y={32} stroke="#6BCF7F" strokeDasharray="6 3" strokeWidth={1.5}/>
              <Line dataKey="__meta__" name="metaRef" legendType="line"
                stroke="#6BCF7F" strokeDasharray="6 3" strokeWidth={1.5}
                dot={false} activeDot={false}/>
              <Line type="monotone" dataKey="prodDrone" name="prodDrone" strokeWidth={2.5}
                stroke="#6BCF7F"
                dot={(props:Record<string,unknown>)=>{
                  const {cx,cy,index,value}=props as {cx:number;cy:number;index:number;value:number};
                  const isLast = index===chartData.length-1;
                  return <circle key={"dd-"+index} cx={cx} cy={cy} r={isLast?7:4}
                    fill={prodHex(value)} stroke="#fff" strokeWidth={isLast?2:1.5}/>;
                }}
                activeDot={{r:7}}
              />
              <Line type="monotone" dataKey="prodPeso" name="prodPeso" strokeWidth={1.5} strokeDasharray="5 4"
                stroke="#94a3b8"
                dot={(props:Record<string,unknown>)=>{
                  const {cx,cy,index,value}=props as {cx:number;cy:number;index:number;value:number};
                  return <circle key={"dp-"+index} cx={cx} cy={cy} r={3}
                    fill={prodHex(value)} stroke="#fff" strokeWidth={1}/>;
                }}
                activeDot={{r:5}}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Grafico 2: Comparativa Anual */}
      {compChart.length > 0 && allYears.length > 0 && (
        <section className="card">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-800 text-sm sm:text-base">Comparativa Anual</h2>
              <p className="text-xs text-gray-400 mt-0.5 hidden sm:block">Barras: produccion total mes · Linea: productividad promedio</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {([["S1","S1"],["S2","S2"],["anual","Año"]] as const).map(([v,label])=>(
                  <button key={v} onClick={()=>setPeriodoComp(v)}
                    className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                    style={periodoComp===v?{backgroundColor:"#6BCF7F",color:"#fff"}:{color:"#6b7280"}}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {([["ambas","Ambas"],["produccion","Produccion"],["productividad","Productividad"]] as const).map(([v,label])=>(
                  <button key={v} onClick={()=>setVistaComp(v)}
                    className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                    style={vistaComp===v?{backgroundColor:"#6BCF7F",color:"#fff"}:{color:"#6b7280"}}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={()=>setShowYrFilter(f=>!f)}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 font-medium hover:border-migrin transition-colors">
                Años {showYrFilter?"^":"v"}
              </button>
            </div>
          </div>

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
              {(vistaComp==="ambas"||vistaComp==="produccion") ? (
                <YAxis yAxisId="ton" orientation="left" tick={{fontSize:9}} width={52} tickLine={false}
                  tickFormatter={v=>v>=1000?(v/1000).toFixed(0)+"k":String(v)}/>
              ) : (
                <YAxis yAxisId="ton" hide/>
              )}
              {(vistaComp==="ambas"||vistaComp==="productividad") ? (
                <YAxis yAxisId="prod" orientation="right" tick={{fontSize:9}} width={36} tickLine={false}
                  tickFormatter={v=>String(v)}/>
              ) : (
                <YAxis yAxisId="prod" hide/>
              )}
              <Tooltip
                formatter={(v,n)=>{
                  const s=String(n);
                  if(s.startsWith("ton_"))  return [fmt(v as number,0)+" ton",  "Produccion "+s.slice(4)];
                  if(s.startsWith("prod_")) return [fmt(v as number,1)+" t/h",  "Productividad "+s.slice(5)];
                  return [v,n];
                }}
                contentStyle={{fontSize:11,borderRadius:10,border:"1px solid #e5e7eb",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}
              />
              <Legend
                wrapperStyle={{fontSize:10,paddingTop:8}}
                formatter={n=>{
                  const s=String(n);
                  if(s.startsWith("ton_"))  return "Prod. "+s.slice(4);
                  if(s.startsWith("prod_")) return "Productiv. "+s.slice(5);
                  return n;
                }}
              />
              {(vistaComp==="ambas"||vistaComp==="produccion") && visibleYears.map((y)=>{
                const ci = allYears.indexOf(y);
                return (
                  <Bar key={"ton_"+y} yAxisId="ton" dataKey={"ton_"+y} name={"ton_"+y}
                    fill={YR_COLORS[ci%YR_COLORS.length]}
                    opacity={y===currentYear?0.85:0.5}
                    radius={[3,3,0,0]}/>
                );
              })}
              {(vistaComp==="ambas"||vistaComp==="productividad") && visibleYears.map((y)=>{
                const ci = allYears.indexOf(y);
                return (
                  <Line key={"prod_"+y} yAxisId="prod" dataKey={"prod_"+y} name={"prod_"+y}
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

      {/* Tabla */}
      <section className="card overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Registros Arena recientes</h2>
          <Link href="/informe" className="text-sm font-medium hover:underline" style={{color:"#6BCF7F"}}>Ver informe</Link>
        </div>
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Productividad</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Inventario</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Prod. Pesom.</th>
              <th className="table-th">Productiv. Pesom.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {arenaRows.slice(0,8).map((r,i)=>(
              <tr key={r.id}
                className={"hover:bg-gray-50 cursor-pointer transition-colors "+(selectedIdx===i?"bg-green-50/40 ring-1 ring-inset ring-migrin/30":"")}
                onClick={()=>setSelectedIdx(i)}>
                <td className="table-td-left">
                  <div className="font-medium">{format(pd(r.fecha),"dd/MM/yyyy")} {r.hora.slice(0,5)}</div>
                  {i===0
                    ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">ultimo</span>
                    : <span className="text-xs text-gray-300">hace {differenceInDays(new Date(),pd(r.fecha))}d</span>
                  }
                </td>
                <td className={"table-td font-bold "+prodText(r.productividad_drone)}>{fmt(r.productividad_drone)} t/h</td>
                <td className="table-td text-gray-800">{fmt(r.produccion_drone)}</td>
                <td className={"table-td font-semibold "+invText(r.inventario_ton)}>{fmt(r.inventario_ton)}</td>
                <td className="table-td text-gray-800">{fmt(r.despachos_ton)}</td>
                <td className="table-td text-gray-800">{fmt(r.produccion_pesometro)}</td>
                <td className="table-td text-gray-800">{fmt(r.productividad_pesometro)} t/h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">Haz clic en una fila para ver sus KPIs arriba</p>
      </section>
    </div>
  );
}

function CapacityBar({ current, max }: { current: number; max: number }) {
  const pct = Math.min(100, Math.round((current / max) * 100));
  let barColor = "#ef4444";
  if (pct >= 65) barColor = "#6BCF7F";
  else if (pct >= 35) barColor = "#eab308";
  return (
    <div style={{ paddingBottom: 2 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
        <span style={{ color: barColor, fontWeight: 600 }}>{pct}% del máx. hist.</span>
        <span style={{ color: "#9ca3af" }}>{"máx."} {fmt(max, 0)} t</span>
      </div>
      <div style={{ height: 6, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 4, background: barColor, width: pct + "%" }}></div>
      </div>
    </div>
  );
}

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

function CuarzoSparkline({ rows }: { rows: import("@/types/database").RegistroCuarzo[] }) {
  const pts = [...rows].reverse().filter(r => (r.inventario_ton ?? 0) > 0);
  if (pts.length < 2) return null;
  const W = 200, H = 72;
  const vals = pts.map(r => r.inventario_ton as number);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const rng = mx - mn || 1;
  const xs = pts.map((_,i) => (i / (pts.length - 1)) * W);
  const ys = vals.map(v => H - ((v - mn) / rng) * (H - 14) - 4);
  const linePts = xs.map((x,i) => (i === 0 ? "M" : "L") + x.toFixed(1) + "," + ys[i].toFixed(1)).join(" ");
  const areaPts = linePts + " L" + xs[xs.length-1].toFixed(1) + "," + H + " L0," + H + " Z";
  const lx = xs[xs.length-1], ly = ys[ys.length-1];
  const firstDate = pts[0]?.fecha ? pts[0].fecha.slice(5,10).replace("-","/") : "";
  const lastDate  = pts[pts.length-1]?.fecha ? pts[pts.length-1].fecha.slice(5,10).replace("-","/") : "";
  return (
    <div style={{width:"100%"}}>
      <svg width="100%" height={H} viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" style={{overflow:"visible"}}>
        <defs>
          <linearGradient id="czGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25}/>
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02}/>
          </linearGradient>
        </defs>
        <path d={areaPts} fill="url(#czGrad)"/>
        <path d={linePts} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={lx} cy={ly} r={4} fill="#2563eb" stroke="white" strokeWidth={1.5}/>
      </svg>
      <div style={{display:"flex", justifyContent:"space-between", fontSize:9, color:"#94a3b8", marginTop:2}}>
        <span>{firstDate}</span>
        <span style={{color:"#3b82f6", fontWeight:600}}>{lastDate} · {fmt(vals[vals.length-1],0)} t</span>
      </div>
    </div>
  );
}

function KpiCard({ label, value, unit, color, icon, trend: trendVal, info, prodVal, invVal }: {
  label:string; value:string; unit:string; color:string; icon:string;
  trend?:number|null; info?:string; prodVal?:number|null; invVal?:number|null;
}) {
  const isProd = color === "prod";
  const isInv  = color === "inv";
  const colorClass = isProd ? prodText(prodVal) : isInv ? invText(invVal) : ({
    blue:"text-blue-600", green:"text-green-600", migrin:"text-migrin",
    purple:"text-purple-600", gray:"text-gray-700",
  }[color]??"text-gray-900");
  const bgClass = isProd ? prodBg(prodVal) : isInv ? invBg(invVal) : ({
    blue:"bg-blue-50", green:"bg-green-50", migrin:"bg-green-50",
    purple:"bg-purple-50", gray:"bg-gray-50",
  }[color]??"bg-gray-50");

  return (
    <div className={"stat-card relative pb-6 " + bgClass + " border border-transparent hover:border-gray-200 transition-colors items-center text-center"}>
      <span className="stat-label w-full text-center">{label}</span>
      <div className="w-full flex items-baseline justify-center gap-1">
        <span className={"stat-value " + colorClass}>{value}</span>
        <span className="text-xs text-gray-400 font-normal">{unit}</span>
      </div>
      {trendVal != null && (
        <span className={"text-xs font-semibold " + (trendVal >= 0 ? "text-green-600" : "text-red-500")}>
          {trendVal >= 0 ? "↑" : "↓"} {Math.abs(trendVal).toFixed(1)}%{" "}
          <span className="font-normal text-gray-400">vs ant.</span>
        </span>
      )}
      {info && (
        <div className="absolute bottom-2 right-2">
          <KpiInfoTooltip text={info}/>
        </div>
      )}
    </div>
  );
}
