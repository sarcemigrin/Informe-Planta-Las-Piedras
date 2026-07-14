import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import AzureADProvider from "next-auth/providers/azure-ad";
import { createClient } from "@supabase/supabase-js";

// Usa service role key para leer usuarios sin depender de RLS
function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function refreshAccessToken(token: Record<string, unknown>) {
  try {
    const url = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type:    "refresh_token",
        refresh_token: token.refreshToken as string,
        scope:         "openid profile email User.Read Files.ReadWrite Mail.Send offline_access",
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error_description ?? data.error ?? "refresh failed"));
    return {
      ...token,
      accessToken:          data.access_token as string,
      refreshToken:         (data.refresh_token as string | undefined) ?? token.refreshToken,
      accessTokenExpiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000,
    } as JWT;
  } catch (e) {
    console.error("[auth] refreshAccessToken error:", e);
    return { ...token, error: "RefreshAccessTokenError" } as JWT;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId:     process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId:     process.env.AZURE_AD_TENANT_ID!,
      authorization: {
        params: {
          scope: "openid profile email User.Read Files.ReadWrite Mail.Send offline_access",
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "azure-ad") return false;
      const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "migrin.cl";
      const p = profile as Record<string, unknown> | undefined;
      const email =
        (p?.["email"] as string | undefined) ??
        (p?.["preferred_username"] as string | undefined) ??
        (p?.["upn"] as string | undefined);
      if (!email || !email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
        console.warn("[auth] signIn rechazado - dominio no autorizado");
        return false;
      }
      return true;
    },

    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken          = account.access_token;
        token.refreshToken         = account.refresh_token;
        token.accessTokenExpiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3500 * 1000;
        const p = profile as Record<string, unknown> | undefined;
        const email =
          (p?.["email"] as string | undefined) ??
          (p?.["preferred_username"] as string | undefined) ??
          (p?.["upn"] as string | undefined) ??
          (token.email as string | undefined);
        if (email) {
          token.email = email;
          try {
            const sb = getSupabaseServer();
            const { data } = await sb
              .from("usuarios")
              .select("rol, activo")
              .eq("email", email.toLowerCase())
              .maybeSingle();
            token.rol = (data?.activo ? data.rol : "sin_acceso") as "admin" | "viewer" | "sin_acceso";
          } catch {
            token.rol = "sin_acceso";
          }
        }
        return token;
      }
      if (Date.now() < (token.accessTokenExpiresAt as number)) {
        return token;
      }
      return refreshAccessToken(token as Record<string, unknown>);
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        session.user.name  = token.name  as string;
        session.user.rol   = token.rol   ?? "sin_acceso";
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error:  "/login",
  },

  session: {
    strategy: "jwt",
    maxAge:   8 * 60 * 60,
  },
};
