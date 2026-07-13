"use client";

import { useSession } from "next-auth/react";
import { useViewerMode } from "@/hooks/useViewerMode";

/**
 * Envuelve secciones que solo pueden usar los admin.
 * Los viewers (o admin en modo vista) ven un mensaje de "solo lectura".
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const { viewerMode } = useViewerMode();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Cargando...
      </div>
    );
  }

  if (session?.user?.rol !== "admin" || viewerMode) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
        <div className="text-5xl"></div>
        <h2 className="text-xl font-semibold text-gray-700">Acceso restringido</h2>
        <p className="text-gray-500 max-w-sm">
          Esta sección es solo para administradores. Contacta a Sebastián Arce si necesitas acceso.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
