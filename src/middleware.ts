import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Middleware de autenticación.
 * Protege todas las rutas excepto /login, /api/auth/* y /api/despachos/import.
 * Si no hay sesión activa → redirige a /login.
 *
 * /api/despachos/import queda excluida porque la llama Power Automate con su
 * propio esquema (Authorization: Bearer DESPACHOS_API_KEY, sin sesión de
 * NextAuth) — si no se excluye, este middleware la redirige a /login antes de
 * que llegue a su propio chequeo, rompiendo la integración en silencio.
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

// Rutas que requieren autenticación (todo excepto login, auth API y el webhook de Power Automate)
export const config = {
  matcher: [
    "/((?!login|api/auth|api/despachos/import|_next/static|_next/image|favicon.ico).*)",
  ],
};
