"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

const linksViewer = [
  { href: "/",        label: "Dashboard" },
  { href: "/diario",  label: "Control Vuelos" },
  { href: "/informe", label: "Informe" },
];

const linksAdmin = [
  { href: "/",          label: "Dashboard" },
  { href: "/arena",     label: "Arena" },
  { href: "/cuarzo",    label: "Cuarzo" },
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

export function Navigation() {
  const pathname          = usePathname();
  const { data: session } = useSession();
  const [open, setOpen]   = useState(false);

  if (pathname === "/login") return null;

  const isAdmin = session?.user?.rol === "admin";
  const links   = isAdmin ? linksAdmin : linksViewer;

  return (
    <nav style={{ backgroundColor: "#3D3D3D" }} className="sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <MigrinLogo />
            <div className="leading-tight">
              <div className="text-white font-bold text-sm tracking-wide">Arena Control</div>
              <div className="text-xs tracking-widest uppercase" style={{ color: "#6BCF7F", fontSize: "9px" }}>
                Migrin · Planta Las Piedras
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

          {/* Usuario + logout */}
          <div className="hidden md:flex items-center gap-3">
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
            {open ? "" : ""}
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
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-xs text-red-400 font-medium hover:text-red-300"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
