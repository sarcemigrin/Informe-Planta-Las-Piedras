import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Middleware de autenticación.
 * Protege todas las rutas excepto /login y /api/auth/*
 * Si no hay sesión activa → redirige a /login
 */
export default withAuth(
  function middleware(req) {
    // Usuario autenticado: dejar pasar
    return NextResponse.next();
  },
  {
    callbacks: {
      // Autorizado si existe el token JWT
      authorized: ({ token }) => !!token,
    },
  }
);

// Rutas que requieren autenticación (todo excepto login y auth API)
export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
