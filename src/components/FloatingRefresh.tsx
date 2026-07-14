"use client";
import { useEffect, useState, useCallback } from "react";

export function FloatingRefresh() {
  const [checking, setChecking] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);

  // Compara el buildId actual con el del servidor
  const checkForUpdate = useCallback(async () => {
    try {
      const res = await fetch("/_next/static/chunks/main.js", { method: "HEAD", cache: "no-store" });
      const serverEtag = res.headers.get("etag") ?? res.headers.get("last-modified") ?? "";
      const stored = sessionStorage.getItem("app-etag");
      if (!stored) {
        sessionStorage.setItem("app-etag", serverEtag);
      } else if (stored !== serverEtag) {
        setHasUpdate(true);
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    // Chequear al montar y cada 5 minutos
    checkForUpdate();
    const id = setInterval(checkForUpdate, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  function refresh() {
    setChecking(true);
    sessionStorage.removeItem("app-etag");
    window.location.reload();
  }

  return (
    <button
      onClick={refresh}
      disabled={checking}
      title={hasUpdate ? "Nueva versión disponible — actualizar" : "Actualizar app"}
      className="fixed bottom-4 right-4 z-40 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95"
      style={{
        background: hasUpdate ? "#6BCF7F" : "#e5e7eb",
        color: hasUpdate ? "#fff" : "#6b7280",
      }}
    >
      {hasUpdate && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
      )}
      <svg
        className={`w-4 h-4 ${checking ? "animate-spin" : ""}`}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  );
}
