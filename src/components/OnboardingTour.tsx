"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

const TOUR_KEY = "arena-tour-v2";

interface Step {
  title: string;
  badge?: string;
  description: string;
  details: string[];
  color: string;
  adminOnly?: boolean;
  icon: "home" | "chart" | "plane" | "report" | "register" | "truck" | "import" | "bot";
}

const ALL_STEPS: Step[] = [
  {
    title: "Bienvenido a Fotogrametria Migrin",
    badge: "Migrin - Faena Las Piedras, Turco y Peral",
    description: "La plataforma digital de gestión de producción. Registra cubicaciones del drone, controla despachos y genera informes automáticos.",
    details: [
      "Todos los datos se guardan en tiempo real",
      "Acceso desde cualquier dispositivo con conexión",
      "Vistas adaptadas según tu perfil de usuario",
    ],
    color: "#374151",
    icon: "home",
  },
  {
    title: "Dashboard",
    badge: "Inicio · /",
    description: "Panel principal con indicadores clave de producción e inventario, separado por zona de operación.",
    details: [
      "Zona Sur: producción Arena y Cuarzo, productividad drone y pesómetro, canchas",
      "Zona Centro (solo admin): inventarios Turco (TLH, Fierrillo) y Peral (Stock Húmeda, cortes A-22 a A-26)",
      "Gráficos de tendencia mensual y variación vs inicio de mes",
      "Tab comparativo con evolución de ambas plantas",
    ],
    color: "#2563eb",
    icon: "chart",
  },
  {
    title: "Control Vuelos",
    badge: "Diario · /diario",
    description: "Historial completo de cubicaciones y actividad diaria de la planta.",
    details: [
      "Calendario con marcadores en los días con registros",
      "Tabla navegable con todos los registros de arena y cuarzo",
      "Filtrado por rango de fechas",
      "Visualización de horas trabajadas y detenciones",
    ],
    color: "#0891b2",
    icon: "plane",
  },
  {
    title: "Informe",
    badge: "Informe · /informe",
    description: "Generación y envío automático de informes semanales de producción.",
    details: [
      "Resumen semanal con KPIs consolidados por semana",
      "Gráfico de evolución de producción y productividad",
      "Tabla detallada de todas las cubicaciones de la semana",
      "Botón para enviar el informe por email a los destinatarios configurados",
      "Descarga directa en PDF con la vista actual",
    ],
    color: "#7c3aed",
    icon: "report",
  },
  {
    title: "Nuevo Registro",
    badge: "Registros · /arena  (solo admin)",
    description: "Ingreso de cubicaciones del drone para Zona Sur y Zona Centro.",
    details: [
      "Zona Sur: producción arena, pesómetro, horas, despachos, inventario",
      "Zona Centro — Turco: inventarios de TLH, Arena Mina, Estéril, Grancilla y Fierrillo",
      "Zona Centro — Peral: inventarios de Arena Mina, A-22 a A-26, DMH y Grancilla",
      "Al guardar se envía notificación automática por email al grupo correspondiente",
    ],
    color: "#059669",
    adminOnly: true,
    icon: "register",
  },
  {
    title: "Despachos",
    badge: "Despachos · /despachos  (solo admin)",
    description: "Gestión de despachos de material hacia distintos destinos.",
    details: [
      "Dashboard con gráfico de despachos por destino",
      "Tabla navegable con historial de despachos",
      "Importación automática desde SharePoint",
      "Registro manual de despachos por fecha, destino y tonelaje",
    ],
    color: "#d97706",
    adminOnly: true,
    icon: "truck",
  },
  {
    title: "Importar",
    badge: "Importar · /importar  (solo admin)",
    description: "Herramienta para importar datos masivos desde SharePoint u otras fuentes externas.",
    details: [
      "Sincronización con listas de SharePoint",
      "Validación automática de datos antes de importar",
      "Historial de importaciones realizadas",
    ],
    color: "#6b7280",
    adminOnly: true,
    icon: "import",
  },
  {
    title: "Asistente IA",
    badge: "Chatbot · disponible en todas las páginas",
    description: "Inteligencia artificial para consultar datos de producción de Zona Sur y Zona Centro en lenguaje natural.",
    details: [
      "Pregunta sobre Arena, Cuarzo, Turco o Peral con tus propias palabras",
      "Respuestas con datos reales actualizados de la base de datos",
      "Consultas de inventario, producción, despachos y tendencias",
      "Disponible en la esquina inferior derecha de la pantalla",
    ],
    color: "#6BCF7F",
    adminOnly: true,
    icon: "bot",
  },
];

function StepIcon({ icon, size = 28 }: { icon: Step["icon"]; size?: number }) {
  const s = size;
  if (icon === "home") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
  if (icon === "chart") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
  if (icon === "plane") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
  if (icon === "report") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
  if (icon === "register") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
  if (icon === "truck") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 11-4 0 2 2 0 014 0zm-8 0H4.5M16 17h1.5M3 6h13l2 5H3V6z" />
    </svg>
  );
  if (icon === "import") return (
    <svg width={s} height={s} fill="none" stroke="white" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
  // bot
  return (
    <svg width={s} height={s} fill="white" viewBox="0 0 24 24">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
    </svg>
  );
}

export function OnboardingTour() {
  const { data: session } = useSession();
  const [visible, setVisible]   = useState(false);
  const [stepIdx, setStepIdx]   = useState(0);

  const isAdmin = session?.user?.rol === "admin";
  const steps   = ALL_STEPS.filter(s => !s.adminOnly || isAdmin);
  const total   = steps.length;
  const step    = steps[stepIdx] ?? steps[0];

  // Mostrar en primera visita
  useEffect(() => {
    if (!session?.user) return;
    try {
      if (!localStorage.getItem(TOUR_KEY)) {
        const t = setTimeout(() => setVisible(true), 800);
        return () => clearTimeout(t);
      }
    } catch { /* noop */ }
  }, [session]);

  // Escuchar evento para reiniciar el tour
  useEffect(() => {
    const handler = () => { setStepIdx(0); setVisible(true); };
    window.addEventListener("arena:start-tour", handler);
    return () => window.removeEventListener("arena:start-tour", handler);
  }, []);

  const finish = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* noop */ }
  }, []);

  const next = () => {
    if (stepIdx < total - 1) setStepIdx(i => i + 1);
    else finish();
  };
  const prev = () => setStepIdx(i => Math.max(0, i - 1));

  if (!visible || !session?.user) return null;

  const isLast  = stepIdx === total - 1;
  const isFirst = stepIdx === 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) finish(); }}
    >
      <div
        className="relative w-full flex flex-col"
        style={{
          maxWidth: 520,
          background: "white",
          borderRadius: 20,
          boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
          overflow: "hidden",
          animation: "tourIn 0.3s ease-out",
        }}
      >
        {/* Barra de color + icono */}
        <div
          className="flex flex-col items-center justify-center py-8 px-6"
          style={{ background: step.color, minHeight: 140 }}
        >
          <div
            className="flex items-center justify-center rounded-full mb-3"
            style={{ width: 64, height: 64, background: "rgba(255,255,255,0.18)" }}
          >
            <StepIcon icon={step.icon} size={32} />
          </div>
          <h2 className="text-white font-bold text-xl text-center leading-tight">{step.title}</h2>
          {step.badge && (
            <span
              className="mt-2 text-xs font-medium px-3 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.9)" }}
            >
              {step.badge}
            </span>
          )}
        </div>

        {/* Contenido */}
        <div className="px-6 pt-5 pb-4">
          <p className="text-sm text-gray-700 leading-relaxed mb-3">{step.description}</p>
          <ul className="space-y-2">
            {step.details.map((d, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-gray-600">
                <span
                  className="mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: step.color + "22", color: step.color }}
                >
                  <svg width={10} height={10} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                {d}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer: dots + botones */}
        <div className="px-6 pb-5 flex items-center justify-between gap-3">
          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStepIdx(i)}
                style={{
                  width:  i === stepIdx ? 20 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i === stepIdx ? step.color : "#d1d5db",
                  transition: "all 0.25s",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Botones */}
          <div className="flex items-center gap-2 shrink-0">
            {!isFirst && (
              <button
                onClick={prev}
                className="text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Anterior
              </button>
            )}
            {isFirst && (
              <button
                onClick={finish}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-2"
              >
                Omitir
              </button>
            )}
            <button
              onClick={next}
              className="text-xs font-semibold px-5 py-2 rounded-xl text-white transition-all hover:opacity-90"
              style={{ background: step.color }}
            >
              {isLast ? "¡Comenzar!" : "Siguiente"}
            </button>
          </div>
        </div>

        {/* Contador */}
        <div
          className="absolute top-3 right-3 text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ background: "rgba(255,255,255,0.25)", color: "white" }}
        >
          {stepIdx + 1} / {total}
        </div>
      </div>

      <style>{`
        @keyframes tourIn {
          from { opacity: 0; transform: scale(0.93) translateY(16px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
