"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router   = useRouter();
  const [loading, setLoading] = useState(false);

  // Si ya hay sesión, redirigir al dashboard
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  async function handleLogin() {
    setLoading(true);
    await signIn("azure-ad", { callbackUrl: "/" });
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Verificando sesión...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-stone-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 w-full max-w-sm space-y-6">

        {/* Logo */}
        <div className="text-center space-y-1">
          <div className="text-5xl">🏔</div>
          <h1 className="text-2xl font-bold text-gray-900">Arena Control</h1>
          <p className="text-sm text-gray-500">Planta Las Piedras</p>
        </div>

        {/* Descripción */}
        <div className="bg-orange-50 rounded-xl p-4 text-sm text-orange-800 text-center">
          Acceso exclusivo para personal de la empresa.<br />
          Inicia sesión con tu cuenta Microsoft corporativa.
        </div>

        {/* Botón login Microsoft */}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-[#0078d4] hover:bg-[#106ebe] active:bg-[#005a9e] text-white font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {/* Ícono Microsoft */}
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
            <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          {loading ? "Iniciando sesión..." : "Iniciar sesión con Microsoft"}
        </button>

        <p className="text-xs text-center text-gray-400">
          Usa tu cuenta @migrin.cl · Acceso protegido por Azure AD
        </p>
      </div>
    </div>
  );
}
