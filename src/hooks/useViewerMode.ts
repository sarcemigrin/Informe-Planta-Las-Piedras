"use client";

import { useState, useEffect, useCallback } from "react";

const KEY = "arena-viewer-mode";

export function useViewerMode() {
  const [viewerMode, setViewerModeState] = useState(false);

  useEffect(() => {
    try { setViewerModeState(localStorage.getItem(KEY) === "1"); } catch {}
    const handler = () => {
      try { setViewerModeState(localStorage.getItem(KEY) === "1"); } catch {}
    };
    window.addEventListener("viewerModeChanged", handler);
    return () => window.removeEventListener("viewerModeChanged", handler);
  }, []);

  const toggle = useCallback(() => {
    const next = localStorage.getItem(KEY) !== "1";
    localStorage.setItem(KEY, next ? "1" : "0");
    window.dispatchEvent(new Event("viewerModeChanged"));
  }, []);

  return { viewerMode, toggle };
}
