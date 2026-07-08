import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      name?:  string | null;
      email?: string | null;
      image?: string | null;
      rol?:   "admin" | "viewer" | "sin_acceso";
      // SEC-2: accessToken eliminado del cliente - usar getToken({ req }) en API routes
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    rol?:                  "admin" | "viewer" | "sin_acceso";
    accessToken?:          string;
    refreshToken?:         string;
    accessTokenExpiresAt?: number;
    error?:                string;
  }
}
