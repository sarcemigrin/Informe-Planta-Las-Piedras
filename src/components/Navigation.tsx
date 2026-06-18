"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

const links = [
  { href: "/",          label: "Dashboard" },
  { href: "/arena",     label: "⛏ Arena" },
  { href: "/cuarzo",    label: "🪨 Cuarzo" },
  { href: "/despachos", label: "🚛 Despachos" },
  { href: "/diario",    label: "📅 Diario" },
  { href: "/informe",   label: "📊 Informe" },
  { href: "/importar",  label: "⬆ Importar" },
];

export function Navigation() {
  const pathname    = usePathname();
  const { data: session } = useSession();
  const [open, setOpen]   = useState(false);

  // No mostrar nav en la página de login
  if (pathname === "/login") return null;

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="font-bold text-orange-600 text-lg tracking-tight">
            🏔 Arena Control
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname === href
                    ? "bg-orange-50 text-orange-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Usuario + logout (desktop) */}
          <div className="hidden md:flex items-center gap-3">
            {session?.user && (
              <>
                <span className="text-xs text-gray-500 max-w-[160px] truncate">
                  {session.user.name ?? session.user.email}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Salir
                </button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            onClick={() => setOpen(!open)}
            aria-label="Menú"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-3 pt-2 flex flex-col gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                pathname === href
                  ? "bg-orange-50 text-orange-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </Link>
          ))}
          {session?.user && (
            <div className="mt-2 border-t border-gray-100 pt-2 flex items-center justify-between">
              <span className="text-xs text-gray-500 truncate">
                {session.user.name ?? session.user.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-xs text-red-500 font-medium"
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
