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
  ResponsiveContainer, Legend,
} from "recharts";
import { format, differenceInDays, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { es } from "date-fns/locale";

// ── Productividad: meta y colores ──────────────────────────
const PROD_TARGET = 32;
const PROD_WARN   = PROD_TARGET * 0.95; // 30.4 t/h  → amarillo (≤5% bajo)
const PROD_CRIT   = PROD_TARGET * 0.90; // 28.8 t/h  → rojo (>10% bajo)

const DENSIDAD   = 1.4;
const MESES      = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const YR_COLORS  = ["#6BCF7F","#3b82f6","#f97316","#a855f7","#ec4899"];

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
  const [arenaRows,     setArenaRows]     = useState<RegistroArena[]>([]);
  const [arenaHistorico,setArenaHistorico]= useState<Pick<RegistroArena,"fecha"|"produccion_drone"|"productividad_drone">[]>([]);
  const [cuarzoRows,    setCuarzoRows]    = useState<RegistroCuarzo[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [selectedIdx,   setSelectedIdx]   = useState(0);
  const [periodoComp,   setPeriodoComp]   = useState<"S1"|"S2"|"anual">("anual");

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
  const { compChart, years, currentYear } = useMemo(() => {
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
        row[`ton_${y}`]  = d?.ton.length  ? d.ton.reduce((a,b)=>a+b,0)                    : null;
        row[`prod_${y}`] = d?.prod.length ? d.prod.reduce((a,b)=>a+b,0)/d.prod.length      : null;
      });
      return row;
    });
    return { compChart: data, years: ys, currentYear: cy };
  }, [arenaHistorico, periodoComp]);

  function trend(cur?:number|null,prv?:number|null){ if(!cur||!prv||prv===0) return null; return ((cur-prv)/prv)*100; }

  // Acopios
  const conosTon  = [(sel?.cono_1??0),(sel?.cono_2??0),(sel?.cono_3??0)].map(v=>v*DENSIDAD);
  const pilasTon  = [(sel?.pila_1??0),(sel?.pila_2??0),(sel?.pila_3??0),(sel?.pila_4??0),(sel?.pila_5??0),(sel?.pila_6??0),(sel?.pila_7??0)].map(v=>v*DENSIDAD);
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Inventario"    value={fmt(sel?.inventario_ton)}         unit="ton"   color="blue"   icon="📦"
            info="Tonelaje total en cancha. Calculado como (conos×0.9 + acopios) × 1.4 ton/m³."
            trend={trend(sel?.inventario_ton, prev?.inventario_ton)}/>
          <KpiCard label="Prod. Drone"   value={fmt(sel?.produccion_drone)}        unit="ton"   color="green"  icon="🚁"
            info="Producción por diferencia de inventario entre droneos consecutivos + despachos del período."
            trend={trend(sel?.produccion_drone, prev?.produccion_drone)}/>
          <KpiCard label="Productividad" value={fmt(sel?.productividad_drone)}     unit="ton/h" color="prod"   icon="⚡"
            info="Toneladas producidas por hora de horómetro. Meta: ≥32 t/h · Amarillo: entre 28.8–32 · Rojo: <28.8."
            trend={trend(sel?.productividad_drone, prev?.productividad_drone)} prodVal={sel?.productividad_drone}/>
          <KpiCard label="Despachos"     value={fmt(sel?.despachos_ton)}           unit="ton"   color="gray"   icon="🚛"
            info="Total toneladas despachadas entre el droneo anterior y este, según datos SAP."
            trend={trend(sel?.despachos_ton, prev?.despachos_ton)}/>
          <KpiCard label="Prod. Pesóm."  value={fmt(sel?.produccion_pesometro)}    unit="ton"   color="migrin" icon="⚖️"
            info="Producción según diferencia de lecturas del pesómetro × factor 0.85. Referencia para comparar con drone."
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
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancha Vieja</span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-gray-800">{fmt(canchaViejaTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
                <KpiInfoTooltip text="Volumen de los 3 conos medidos por drone × 1.4 ton/m³. Corresponde al stock apilado en cancha histórica."/>
              </div>
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
          </div>

          {/* Cancha Nueva */}
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancha Nueva</span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-gray-800">{fmt(canchaNuevaTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></span>
                <KpiInfoTooltip text="Volumen de los 4 acopios principales (pilas 1–4) medidos por drone × 1.4 ton/m³."/>
              </div>
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
          </div>

          {/* Riñones */}
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Riñones</span>
              <KpiInfoTooltip text="Acopios pequeños consolidados (pilas 5–7). Material acumulado en zonas secundarias de la cancha."/>
            </div>
            <p className="text-2xl font-bold text-gray-800">{fmt(riñonesTon,0)} <span className="text-xs font-normal text-gray-400">ton</span></p>
            <div className="grid grid-cols-3 gap-1">
              {["P5","P6","P7"].map((lbl,n)=>(
                <div key={n} className="bg-gray-50 rounded-lg px-1 py-1.5 text-center">
                  <p className="text-xs text-gray-400">{lbl}</p>
                  <p className="text-xs font-semibold text-gray-700">{fmt(pilasTon[n+4],0)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Gráfico productividad ── */}
      {chartData.length > 0 && (
        <section className="card">
          <div className="mb-4">
            <h2 className="font-semibold text-gray-800">Productividad Arena — últimas {chartData.length} mediciones</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="text-green-600 font-semibold">●</span> ≥32 t/h &nbsp;
              <span className="text-yellow-500 font-semibold">●</span> 28.8–32 t/h &nbsp;
              <span className="text-red-500 font-semibold">●</span> &lt;28.8 t/h
            </p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{top:10,right:20,left:5,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
              <XAxis dataKey="fecha" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:11}} width={52} domain={["auto","auto"]}
                tickFormatter={v=>`${v}`}/>
              <Tooltip
                formatter={(v,n)=>[`${fmt(v as number)} t/h`, n==="prodDrone"?"Productiv. Drone":"Productiv. Pesóm."]}
                contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e5e7eb"}}
              />
              <Legend formatter={n=>n==="prodDrone"?"Productiv. Drone":"Productiv. Pesóm."}/>
              <Line type="monotone" dataKey="prodDrone" name="prodDrone" strokeWidth={2.5}
                stroke="#6BCF7F"
                dot={(props:Record<string,unknown>)=>{
                  const {cx,cy,index,value}=props as {cx:number;cy:number;index:number;value:number};
                  const isLast = index===chartData.length-1;
                  return <circle key={`dd-${index}`} cx={cx} cy={cy} r={isLast?7:4} fill={prodHex(value)} stroke="#fff" strokeWidth={isLast?2:1}/>;
                }}
                label={(props:Record<string,unknown>)=>{
                  const {x,y,index,value}=props as {x:number;y:number;index:number;value:number};
                  if(index===chartData.length-1) return <text key="last-d" x={x} y={(y as number)-12} textAnchor="middle" fontSize={11} fontWeight="bold" fill={prodHex(value)}>{fmt(value,1)}</text>;
                  if(index % 3 === 0) return <text key={`lbl-d-${index}`} x={x} y={(y as number)-9} textAnchor="middle" fontSize={9} fill="#9ca3af">{fmt(value,1)}</text>;
                  return <text key={`e-${index}`}/>;
                }}
                activeDot={{r:8}}
              />
              <Line type="monotone" dataKey="prodPeso" name="prodPeso" strokeWidth={1.5} strokeDasharray="5 4"
                stroke="#94a3b8"
                dot={(props:Record<string,unknown>)=>{
                  const {cx,cy,index,value}=props as {cx:number;cy:number;index:number;value:number};
                  const isLast = index===chartData.length-1;
                  return <circle key={`dp-${index}`} cx={cx} cy={cy} r={isLast?6:3} fill={prodHex(value)} stroke="#fff" strokeWidth={1}/>;
                }}
                activeDot={{r:6}}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Comparativa anual ── */}
      {compChart.length > 0 && years.length > 0 && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">Comparativa Anual — Producción &amp; Productividad Drone</h2>
              <p className="text-xs text-gray-400 mt-0.5">Barras: producción total del mes · Línea: productividad promedio mensual</p>
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {([["S1","Ene–Jun"],["S2","Jul–Dic"],["anual","Año completo"]] as const).map(([v,label])=>(
                <button key={v} onClick={()=>setPeriodoComp(v)}
                  className="text-xs px-3 py-1 rounded-md font-medium transition-colors"
                  style={periodoComp===v?{backgroundColor:"#6BCF7F",color:"#fff"}:{color:"#6b7280"}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={compChart} margin={{top:5,right:50,left:10,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
              <XAxis dataKey="mes" tick={{fontSize:11}}/>
              <YAxis yAxisId="ton"  orientation="left"  tick={{fontSize:10}} width={65}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(1)}k`:String(v)}/>
              <YAxis yAxisId="prod" orientation="right" tick={{fontSize:10}} width={40}
                tickFormatter={v=>`${v}`}/>
              <Tooltip
                formatter={(v,n)=>{
                  const s=String(n);
                  if(s.startsWith("ton_"))  return [`${fmt(v as number)} ton`,  `Producción ${s.slice(4)}`];
                  if(s.startsWith("prod_")) return [`${fmt(v as number)} t/h`,  `Productividad ${s.slice(5)}`];
                  return [v,n];
                }}
                contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e5e7eb"}}
              />
              <Legend formatter={n=>{
                const s=String(n);
                if(s.startsWith("ton_"))  return `Producción ${s.slice(4)}`;
                if(s.startsWith("prod_")) return `Productividad ${s.slice(5)}`;
                return n;
              }}/>
              {years.map((y,i)=>(
                <Bar key={`ton_${y}`} yAxisId="ton" dataKey={`ton_${y}`} name={`ton_${y}`}
                  fill={YR_COLORS[i%YR_COLORS.length]} opacity={y===currentYear?0.85:0.45} radius={[3,3,0,0]}/>
              ))}
              {years.map((y,i)=>(
                <Line key={`prod_${y}`} yAxisId="prod" dataKey={`prod_${y}`} name={`prod_${y}`}
                  stroke={YR_COLORS[i%YR_COLORS.length]} strokeWidth={y===currentYear?2.5:1.5}
                  dot={{r:3}} connectNulls strokeDasharray={y===currentYear?"0":"5 3"}/>
              ))}
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
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Productividad</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Inventario</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Prod. Pesóm.</th>
              <th className="table-th">Produc. Pesóm.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {arenaRows.slice(0,8).map((r,i)=>(
              <tr key={r.id}
                className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedIdx===i?"bg-green-50/40 ring-1 ring-inset ring-migrin/30":""}`}
                onClick={()=>setSelectedIdx(i)}>
                <td className="table-td-left">
                  <div className="font-medium text-sm">{format(new Date(r.fecha),"dd/MM/yyyy")} {r.hora.slice(0,5)}</div>
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

// ── Subcomponents ─────────────────────────────────────────

function KpiInfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        className="w-4 h-4 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 hover:text-gray-700 text-xs flex items-center justify-center font-bold leading-none select-none"
        onMouseEnter={()=>setShow(true)}
        onMouseLeave={()=>setShow(false)}
        onClick={e=>e.stopPropagation()}
      >i</button>
      {show && (
        <div className="absolute bottom-6 left-0 z-50 w-52 bg-gray-800 text-white text-xs rounded-xl px-3 py-2 shadow-xl leading-relaxed whitespace-normal pointer-events-none">
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
    <div className={`stat-card relative ${bgClass} border border-transparent hover:border-gray-200 transition-colors`}>
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
        <div className="absolute bottom-2 left-2">
          <KpiInfoTooltip text={info}/>
        </div>
      )}
    </div>
  );
}
