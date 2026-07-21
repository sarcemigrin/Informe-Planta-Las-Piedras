"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h2 style={{ color: "#dc2626", marginBottom: "1rem" }}>Error de la aplicación</h2>
      <pre style={{
        background: "#fef2f2", border: "1px solid #fca5a5",
        padding: "1rem", borderRadius: "8px",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        fontSize: "13px", color: "#7f1d1d",
      }}>
        {error?.message ?? "Error desconocido"}
        {error?.stack ? "\n\n" + error.stack : ""}
      </pre>
      <button
        onClick={reset}
        style={{ marginTop: "1rem", padding: "8px 16px", background: "#6BCF7F", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
      >
        Reintentar
      </button>
    </div>
  );
}
