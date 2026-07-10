"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const SUGGESTIONS = [
  "¿Cuál es la productividad del último registro?",
  "¿Cuál es la producción del último droneo?",
  "¿Cuál es el inventario actual de arena?",
  "¿Cuál es el inventario actual de cuarzo?",
  "¿Cuántas horas de operación tiene el último registro?",
  "¿Cuántas horas de detención tiene el último registro?",
];

const TOOLTIP_KEY = "arena-chat-tooltip-v1";

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const isList = line.startsWith("- ") || line.startsWith("• ");
        const content = isList ? line.slice(2) : line;
        const formatted = content
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>");
        if (isList) {
          return (
            <div key={i} className="flex gap-1.5 my-0.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
              <span dangerouslySetInnerHTML={{ __html: formatted }} />
            </div>
          );
        }
        if (line.startsWith("## ")) return <p key={i} className="font-bold text-sm mt-2 mb-0.5">{line.slice(3)}</p>;
        if (line === "") return <div key={i} className="h-1.5" />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: formatted }} />;
      })}
    </>
  );
}

export function ChatBot() {
  const { data: session }                         = useSession();
  const [open, setOpen]                           = useState(false);
  const [messages, setMessages]                   = useState<Message[]>([]);
  const [input, setInput]                         = useState("");
  const [loading, setLoading]                     = useState(false);
  const [showTooltip, setShowTooltip]             = useState(false);
  const bottomRef                                 = useRef<HTMLDivElement>(null);
  const inputRef                                  = useRef<HTMLInputElement>(null);
  const abortRef                                  = useRef<AbortController | null>(null);

  // ── Hooks ALWAYS called (before any conditional return) ──────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Mostrar tooltip solo la primera vez
  useEffect(() => {
    try {
      if (!localStorage.getItem(TOOLTIP_KEY)) {
        const timer = setTimeout(() => setShowTooltip(true), 1500);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage no disponible (SSR safety)
    }
  }, []);

  // Auto-cerrar tooltip a los 10 segundos
  useEffect(() => {
    if (!showTooltip) return;
    const timer = setTimeout(() => dismissTooltip(), 10000);
    return () => clearTimeout(timer);
  }, [showTooltip]);

  const dismissTooltip = useCallback(() => {
    setShowTooltip(false);
    try { localStorage.setItem(TOOLTIP_KEY, "1"); } catch { /* noop */ }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);

    const assistantIdx = newHistory.length;
    setMessages(prev => [...prev, { role: "assistant", content: "", streaming: true }]);

    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          messages: newHistory.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const errMsg  = errBody?.error ?? `HTTP ${res.status}`;
        setMessages(prev =>
          prev.map((m, idx) =>
            idx === assistantIdx ? { ...m, content: `Error del servidor: ${errMsg}`, streaming: false } : m
          )
        );
        return;
      }
      if (!res.body) throw new Error("Sin cuerpo en la respuesta");

      const reader    = res.body.getReader();
      const decoder   = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setMessages(prev =>
          prev.map((m, idx) =>
            idx === assistantIdx ? { ...m, content: current, streaming: true } : m
          )
        );
      }

      setMessages(prev =>
        prev.map((m, idx) =>
          idx === assistantIdx ? { ...m, streaming: false } : m
        )
      );
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") {
        const msg = e instanceof Error ? e.message : "Error desconocido";
        setMessages(prev =>
          prev.map((m, idx) =>
            idx === assistantIdx
              ? { ...m, content: `Error: ${msg}`, streaming: false }
              : m
          )
        );
      }
    } finally {
      setLoading(false);
    }
  }, [messages, loading]);

  // ── Early return AFTER all hooks ─────────────────────────────────────────
  if (!session?.user) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setLoading(false);
  };

  const handleOpenChat = () => {
    dismissTooltip();
    setOpen(o => !o);
  };

  return (
    <>
      {/* Panel de chat */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-50 flex flex-col"
          style={{
            width: "min(420px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 120px))",
            background: "white",
            borderRadius: "16px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)",
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ background: "#374151", color: "white" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "#6BCF7F" }}>
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Asistente Arena</p>
                <p className="text-xs opacity-60 leading-tight">Pregunta sobre producción</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={clearChat} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white" title="Limpiar chat">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white" title="Cerrar">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ background: "#f8fafc" }}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 pb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#6BCF7F20" }}>
                  <svg className="w-6 h-6" style={{ color: "#6BCF7F" }} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">¿En qué puedo ayudarte?</p>
                  <p className="text-xs text-gray-400 mt-0.5">Pregunta sobre producción, despachos o inventario</p>
                </div>
                <div className="w-full space-y-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => sendMessage(s)}
                      className="w-full text-left text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-green-300 hover:text-green-700 hover:bg-green-50 transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className="max-w-[85%] text-xs leading-relaxed px-3 py-2.5 rounded-2xl"
                    style={
                      msg.role === "user"
                        ? { background: "#374151", color: "white", borderBottomRightRadius: "4px" }
                        : { background: "white", color: "#374151", border: "1px solid #e5e7eb", borderBottomLeftRadius: "4px" }
                    }
                  >
                    {msg.role === "assistant" ? (
                      <>
                        <MarkdownText text={msg.content || " "} />
                        {msg.streaming && (
                          <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle rounded-sm animate-pulse" style={{ background: "#6BCF7F" }} />
                        )}
                      </>
                    ) : msg.content}
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2.5 border-t border-gray-100 bg-white shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu pregunta…"
                disabled={loading}
                className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:border-green-400 focus:bg-white transition-all placeholder-gray-400 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                style={{ background: input.trim() && !loading ? "#6BCF7F" : "#e5e7eb", color: input.trim() && !loading ? "white" : "#9ca3af" }}
              >
                {loading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tooltip de bienvenida (primera visita) */}
      {showTooltip && !open && (
        <div
          className="fixed z-50"
          style={{ bottom: "88px", right: "16px", width: "min(280px, calc(100vw - 32px))" }}
        >
          <div
            style={{
              background: "#374151",
              borderRadius: "14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
              padding: "14px 16px",
              position: "relative",
              animation: "slideUp 0.35s ease-out",
            }}
          >
            {/* Flecha apuntando al botón */}
            <div style={{
              position: "absolute",
              bottom: "-8px",
              right: "24px",
              width: 0,
              height: 0,
              borderLeft: "8px solid transparent",
              borderRight: "8px solid transparent",
              borderTop: "8px solid #374151",
            }} />

            {/* Contenido */}
            <div className="flex items-start gap-3">
              <div
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "#6BCF7F" }}
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-tight">¡Nuevo! Asistente Arena</p>
                <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                  Pregunta sobre producción, inventario y despachos en lenguaje natural.
                </p>
                <button
                  onClick={handleOpenChat}
                  className="mt-2.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: "#6BCF7F", color: "white" }}
                >
                  Abrir asistente
                </button>
              </div>
              <button
                onClick={dismissTooltip}
                className="shrink-0 p-0.5 text-gray-400 hover:text-white transition-colors"
                title="Cerrar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Animación CSS */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Botón flotante */}
      <button
        onClick={handleOpenChat}
        className={`fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${showTooltip && !open ? "animate-bounce" : ""}`}
        style={{ background: open ? "#374151" : "#6BCF7F" }}
        title="Asistente Arena"
      >
        {open ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
          </svg>
        )}
      </button>
    </>
  );
}
