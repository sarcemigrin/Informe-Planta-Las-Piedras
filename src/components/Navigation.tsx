"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import { useViewerMode } from "@/hooks/useViewerMode";

const linksViewer = [
  { href: "/",        label: "Dashboard" },
  { href: "/diario",  label: "Control Vuelos" },
  { href: "/informe", label: "Informe" },
];

const linksAdmin = [
  { href: "/",          label: "Dashboard" },
  { href: "/arena",     label: "Registros" },
  { href: "/despachos", label: "Despachos" },
  { href: "/diario",    label: "Control Vuelos" },
  { href: "/informe",   label: "Informe" },
  { href: "/importar",  label: "Importar" },
];

function MigrinLogo() {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: "50%", background: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 6, flexShrink: 0,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/nav-logo-b.png" alt="Migrin" width={32} height={32}
        style={{ objectFit: "contain", display: "block" }} />
    </div>
  );
}

function TourButton() {
  const startTour = () => window.dispatchEvent(new CustomEvent("arena:start-tour"));
  return (
    <button
      onClick={startTour}
      title="Ver guía de la aplicación"
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/10"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="hidden lg:inline">Guía</span>
    </button>
  );
}

export function Navigation() {
  const pathname          = usePathname();
  const { data: session } = useSession();
  const [open, setOpen]   = useState(false);
  const { viewerMode, toggle: toggleViewer } = useViewerMode();

  if (pathname === "/login") return null;

  const isAdmin = session?.user?.rol === "admin";
  const links   = (isAdmin && !viewerMode) ? linksAdmin : linksViewer;

  return (
    <nav style={{ backgroundColor: "#3D3D3D" }} className="sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <MigrinLogo />
            <div className="leading-tight">
              <div className="text-white font-bold text-sm tracking-wide">Fotogrametria Migrin</div>
              <div className="text-xs tracking-widest uppercase" style={{ color: "#6BCF7F", fontSize: "9px" }}>
                Migrin - Faena Las Piedras, Turco y Peral
              </div>
            </div>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname === href
                    ? "text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/10"
                }`}
                style={pathname === href ? { backgroundColor: "#6BCF7F", color: "#fff" } : {}}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Usuario + guía + logout */}
          <div className="hidden md:flex items-center gap-2">
            {session?.user && (
              <>
                <div className="text-right">
                  <div className="text-xs text-white truncate max-w-[160px]">
                    {session.user.name ?? session.user.email}
                  </div>
                  {!isAdmin && (
                    <div className="text-xs" style={{ color: "#6BCF7F" }}>Solo lectura</div>
                  )}
                </div>
                {isAdmin && (
                  <button
                    onClick={toggleViewer}
                    title={viewerMode ? "Volver a vista admin" : "Ver como visitante"}
                    className={`flex items-center gap-1.5 text-xs transition-colors px-2 py-1 rounded-lg ${
                      viewerMode
                        ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                        : "text-gray-400 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d={viewerMode
                          ? "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                          : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"}
                      />
                    </svg>
                    <span className="hidden lg:inline">{viewerMode ? "Admin" : "Visitante"}</span>
                  </button>
                )}
                <TourButton />
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded"
                >
                  Salir
                </button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10"
            onClick={() => setOpen(!open)}
            aria-label="Menú"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-white/10 px-4 pb-3 pt-2 flex flex-col gap-1"
          style={{ backgroundColor: "#2e2e2e" }}>
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === href ? "text-white" : "text-gray-400 hover:text-white"
              }`}
              style={pathname === href ? { backgroundColor: "#6BCF7F", color: "#fff" } : {}}
            >
              {label}
            </Link>
          ))}
          {session?.user && (
            <div className="mt-2 border-t border-white/10 pt-2 flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-300 truncate block">
                  {session.user.name ?? session.user.email}
                </span>
                {!isAdmin && (
                  <span className="text-xs" style={{ color: "#6BCF7F" }}>Solo lectura</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("arena:start-tour")); }}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Guía
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-xs text-red-400 font-medium hover:text-red-300"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
