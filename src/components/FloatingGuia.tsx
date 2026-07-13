"use client";

export function FloatingGuia() {
  const startTour = () => window.dispatchEvent(new CustomEvent("arena:start-tour"));
  return (
    <button
      onClick={startTour}
      title="Ver guía de la aplicación"
      className="fixed bottom-24 right-4 z-40 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95"
      style={{ backgroundColor: "#4b5563", color: "white" }}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  );
}
