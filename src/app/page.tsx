"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/calculations";
import type { RegistroArena, RegistroCuarzo } from "@/types/database";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { format, differenceInDays, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { es } from "date-fns/locale";

const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const YEAR_COLORS = ["#6BCF7F","#3b82f6","#f97316","#a855f7"];

export default function Dashboard() {
  const [arenaRows, setArenaRows]         = useState<RegistroArena[]>([]);
  const [arenaHistorico, setArenaHistorico] = useState<RegistroArena[]>([]);
  const [cuarzoRows, setCuarzoRows]       = useState<RegistroCuarzo[]>([]);
  const [loading, setLoading]             = useState(true);
  const [chartView, setChartView]         = useState<"produccion"|"inventario">("produccion");
  const [selectedIdx, setSelectedIdx]     = useState(0);   // índice del droneo seleccionado
  const [periodoComp, setPeriodoComp]     = useState<"S1"|"S2"|"anual">("anual");

  useEffect(() => {
    async function load() {
      const [{ data: arena }, { data: cuarzo }, { data: historico }] = await Promise.all([
        supabase.from("registros_arena").select("*").order("fecha_hora",{ ascending:false }).limit(30),
        supabase.from("registros_cuarzo").select("*").order("fecha_hora",{ ascending:false }).limit(5),
        supabase.from("registros_arena")
          .select("fecha,fecha_hora,produccion_drone,produccion_pesometro,inventario_ton,productividad_drone,productividad_pesometro")
          .order("fecha_hora",{ ascending:true })
          .gte("fecha","2023-01-01"),
      ]);
      setArenaRows(arena ?? []);
      setCuarzoRows(cuarzo ?? []);
      setArenaHistorico(historico ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // Droneo actualmente seleccionado para KPIs
  const selRow  = arenaRows[selectedIdx];
  const prevRow = arenaRows[selectedIdx + 1];
  const ultimoCuarzo = cuarzoRows[0];

  // Días desde droneo seleccionado
  const diasDesde = selRow ? differenceInDays(new Date(), new Date(selRow.fecha)) : null;

  // Tendencia semanal
  const now = new Date();
  const startThis = startOfWeek(now,{weekStartsOn:1});
  const startLast = startOfWeek(subWeeks(now,1),{weekStartsOn:1});
  const endLast   = endOfWeek(subWeeks(now,1),{weekStartsOn:1});
  const thisWk = arenaRows.filter(r => new Date(r.fecha) >= startThis);
  const lastWk = arenaRows.filter(r => { const d=new Date(r.fecha); return d>=startLast && d<=endLast; });
  const avgThis = thisWk.length ? thisWk.reduce((s,r)=>s+(r.produccion_drone??0),0)/thisWk.length : 0;
  const avgLast = lastWk.length ? lastWk.reduce((s,r)=>s+(r.produccion_drone??0),0)/lastWk.length : 0;
  const tendencia = avgLast>0 ? ((avgThis-avgLast)/avgLast)*100 : null;

  // Chart principal (últimas 15 mediciones)
  const chartData = useMemo(()=>
    [...arenaRows].reverse().slice(-15).map(r=>({
      fecha:     format(new Date(r.fecha),"dd/MM",{locale:es}),
      drone:     r.produccion_drone,
      pesometro: r.produccion_pesometro,
      inv:       r.inventario_ton,
      prodDrone: r.productividad_drone,
      prodPeso:  r.productividad_pesometro,
    }))
  , [arenaRows]);

  // Gráfico comparativa anual — promedios por mes según período
  const compChart = useMemo(() => {
    const mesesFiltro = periodoComp==="S1" ? [0,1,2,3,4,5]
                      : periodoComp==="S2" ? [6,7,8,9,10,11]
                      : [0,1,2,3,4,5,6,7,8,9,10,11];

    const byYearMonth: Record<number, Record<number, number[]>> = {};
    arenaHistorico.forEach(r => {
      const d = new Date(r.fecha);
      const y = d.getFullYear();
      const m = d.getMonth();
      if (!mesesFiltro.includes(m)) return;
      if (!byYearMonth[y]) byYearMonth[y] = {};
      if (!byYearMonth[y][m]) byYearMonth[y][m] = [];
      byYearMonth[y][m].push(r.produccion_drone ?? 0);
    });

    const years = Object.keys(byYearMonth).map(Number).sort();
    return mesesFiltro.map(m => {
      const row: Record<string,unknown> = { mes: MESES[m] };
      years.forEach(y => {
        const vals = byYearMonth[y]?.[m];
        row[String(y)] = vals?.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      });
      return row;
    });
  }, [arenaHistorico, periodoComp]);

  const years = useMemo(()=>{
    const ys = new Set(arenaHistorico.map(r=>new Date(r.fecha).getFullYear()));
    return Array.from(ys).sort();
  }, [arenaHistorico]);

  function trend(cur?:number|null, prev?:number|null) {
    if(!cur||!prev||prev===0) return null;
    return ((cur-prev)/prev)*100;
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>;

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

      {/* ── Arena KPIs + selector de droneo ── */}
      <section>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">⛏ Arena</h2>
          {/* Selector de droneo */}
          <select
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-migrin/30"
            value={selectedIdx}
            onChange={e => setSelectedIdx(Number(e.target.value))}
          >
            {arenaRows.map((r,i) => (
              <option key={r.id} value={i}>
                {i===0 ? "★ " : ""}{format(new Date(r.fecha),"dd/MM/yyyy")} {r.hora?.slice(0,5)}
              </option>
            ))}
          </select>
          {diasDesde !== null && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              diasDesde===0 ? "bg-green-100 text-green-700" :
              diasDesde<=2  ? "bg-yellow-100 text-yellow-700" :
                              "bg-red-100 text-red-600"
            }`}>{diasDesde===0?"Hoy":`Hace ${diasDesde}d`}</span>
          )}
          {selectedIdx===0 && tendencia!==null && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tendencia>=0?"bg-green-50 text-green-700":"bg-red-50 text-red-600"}`}>
              {tendencia>=0?"↑":"↓"} {Math.abs(tendencia).toFixed(1)}% sem.
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Inventario"    value={fmt(selRow?.inventario_ton)}          unit="ton"   color="blue"   icon="📦" trend={trend(selRow?.inventario_ton,prevRow?.inventario_ton)} />
          <KpiCard label="Prod. Drone"   value={fmt(selRow?.produccion_drone)}         unit="ton"   color="green"  icon="🚁" trend={trend(selRow?.produccion_drone,prevRow?.produccion_drone)} />
          <KpiCard label="Prod. Pesóm."  value={fmt(selRow?.produccion_pesometro)}     unit="ton"   color="migrin" icon="⚖️" trend={trend(selRow?.produccion_pesometro,prevRow?.produccion_pesometro)} />
          <KpiCard label="Productividad" value={fmt(selRow?.productividad_drone)}      unit="ton/h" color="purple" icon="⚡" trend={trend(selRow?.productividad_drone,prevRow?.productividad_drone)} />
          <KpiCard label="Despachos"     value={fmt(selRow?.despachos_ton)}            unit="ton"   color="gray"   icon="🚛" trend={trend(selRow?.despachos_ton,prevRow?.despachos_ton)} />
          <KpiCard label="Cancha Nueva"  value={fmt(selRow?.cancha_nueva_ton)}         unit="ton"   color="yellow" icon="🏔️" trend={trend(selRow?.cancha_nueva_ton,prevRow?.cancha_nueva_ton)} />
        </div>
      </section>

      {/* ── Cuarzo: solo inventario ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">🪨 Cuarzo</h2>
          {ultimoCuarzo && (
            <span className="text-xs text-gray-400">último droneo {format(new Date(ultimoCuarzo.fecha),"dd/MM/yyyy")}</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-1 max-w-[200px]">
          <KpiCard label="Inventario" value={fmt(ultimoCuarzo?.inventario_ton)} unit="ton" color="blue" icon="📦" />
        </div>
      </section>

      {/* ── Gráfico producción + productividad en tooltip ── */}
      {chartData.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Producción Arena — últimas 15 mediciones</h2>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {(["produccion","inventario"] as const).map(v => (
                <button key={v} onClick={()=>setChartView(v)}
                  className="text-xs px-3 py-1 rounded-md font-medium transition-colors"
                  style={chartView===v?{backgroundColor:"#6BCF7F",color:"#fff"}:{color:"#6b7280"}}>
                  {v==="produccion"?"Producción":"Inventario"}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{top:5,right:20,left:10,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
              <XAxis dataKey="fecha" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:11}} width={70} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(1)}k`:v}/>
              <Tooltip
                formatter={(value, name) => {
                  const labels: Record<string,string> = {
                    drone:"Prod. Drone", pesometro:"Prod. Pesómetro",
                    inv:"Inventario", prodDrone:"Produc. Drone", prodPeso:"Produc. Pesóm.",
                  };
                  const unit = name==="prodDrone"||name==="prodPeso" ? " t/h" : " ton";
                  return [fmt(value as number)+unit, labels[name as string]??name];
                }}
                contentStyle={{fontSize:12, borderRadius:8, border:"1px solid #e5e7eb"}}
              />
              <Legend/>
              {chartView==="produccion" ? (
                <>
                  <Line type="monotone" dataKey="drone"     name="Prod. Drone"     stroke="#6BCF7F" strokeWidth={2.5} dot={{r:4,fill:"#6BCF7F"}} activeDot={{r:6}}/>
                  <Line type="monotone" dataKey="pesometro" name="Prod. Pesómetro" stroke="#f97316" strokeWidth={2}   dot={{r:3}} activeDot={{r:5}}/>
                  <Line type="monotone" dataKey="prodDrone" name="Produc. Drone"   stroke="#6BCF7F" strokeWidth={1.5} dot={false} strokeDasharray="4 4" activeDot={{r:4}}/>
                  <Line type="monotone" dataKey="prodPeso"  name="Produc. Pesóm."  stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="4 4" activeDot={{r:4}}/>
                </>
              ) : (
                <Line type="monotone" dataKey="inv" name="Inventario" stroke="#3b82f6" strokeWidth={2.5} dot={{r:4,fill:"#3b82f6"}} activeDot={{r:6}}/>
              )}
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Comparativa anual ── */}
      {compChart.length > 0 && years.length > 0 && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">Comparativa Anual — Producción Drone Arena</h2>
              <p className="text-xs text-gray-400 mt-0.5">Promedio mensual por año</p>
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
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={compChart} margin={{top:5,right:20,left:10,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
              <XAxis dataKey="mes" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:11}} width={60} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(1)}k`:v}/>
              <Tooltip formatter={(v,n)=>[fmt(v as number)+" ton", n]} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e5e7eb"}}/>
              <Legend/>
              {years.map((y,i)=>(
                <Line key={y} type="monotone" dataKey={String(y)} name={String(y)}
                  stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={y===new Date().getFullYear()?2.5:1.5}
                  dot={{r:3}} connectNulls/>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Tabla registros recientes ── */}
      <section className="card overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Registros Arena recientes</h2>
          <Link href="/informe" className="text-sm font-medium hover:underline" style={{color:"#6BCF7F"}}>Ver informe →</Link>
        </div>
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="table-th text-left">Fecha</th>
              <th className="table-th">Pesómetro</th>
              <th className="table-th">Prod. Drone</th>
              <th className="table-th">Prod. Peso</th>
              <th className="table-th">Inventario</th>
              <th className="table-th">Despachos</th>
              <th className="table-th">Productividad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {arenaRows.slice(0,8).map((r,i)=>(
              <tr key={r.id}
                className={`hover:bg-gray-50 cursor-pointer ${selectedIdx===i?"ring-1 ring-inset ring-migrin/40 bg-green-50/30":""} ${i===0&&selectedIdx!==0?"":""}` }
                onClick={()=>setSelectedIdx(i)}>
                <td className="table-td-left font-medium">
                  {format(new Date(r.fecha),"dd/MM/yyyy")} {r.hora.slice(0,5)}
                  {i===0&&<span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">último</span>}
                </td>
                <td className="table-td">{r.pesometro?.toLocaleString("es-CL")}</td>
                <td className="table-td text-green-700 font-semibold">{fmt(r.produccion_drone)}</td>
                <td className="table-td text-migrin">{fmt(r.produccion_pesometro)}</td>
                <td className="table-td text-blue-700">{fmt(r.inventario_ton)}</td>
                <td className="table-td">{fmt(r.despachos_ton)}</td>
                <td className="table-td">{fmt(r.productividad_drone)} t/h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">💡 Haz clic en una fila para ver sus KPIs arriba</p>
      </section>
    </div>
  );
}

function KpiCard({ label, value, unit, color, icon, trend: trendVal }: {
  label:string; value:string; unit:string; color:string; icon:string; trend?:number|null;
}) {
  const colors: Record<string,string> = {
    blue:"text-blue-600", green:"text-green-600", migrin:"text-migrin",
    purple:"text-purple-600", gray:"text-gray-700", yellow:"text-yellow-600",
  };
  const bgColors: Record<string,string> = {
    blue:"bg-blue-50", green:"bg-green-50", migrin:"bg-green-50",
    purple:"bg-purple-50", gray:"bg-gray-50", yellow:"bg-yellow-50",
  };
  return (
    <div className={`stat-card ${bgColors[color]??""} border border-transparent hover:border-gray-200 transition-colors`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-base">{icon}</span>
        {trendVal!=null&&(
          <span className={`text-xs font-bold ${trendVal>=0?"text-green-600":"text-red-500"}`}>
            {trendVal>=0?"↑":"↓"} {Math.abs(trendVal).toFixed(1)}%
          </span>
        )}
      </div>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${colors[color]??"text-gray-900"}`}>{value}</span>
      <span className="text-xs text-gray-400">{unit}</span>
    </div>
  );
}
