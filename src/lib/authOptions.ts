import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
    };
  } catch (e) {
    console.error("[auth] refreshAccessToken error:", e);
    return { ...token, error: "RefreshAccessTokenError" };
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
    async signIn({ account }) {
      if (account?.provider === "azure-ad") return true;
      return false;
    },

    async jwt({ token, account, profile }) {
      // Primera vez que inicia sesión — guardar tokens y rol
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
            const { data, error } = await sb
              .from("usuarios")
              .select("rol, activo")
              .eq("email", email.toLowerCase())
              .maybeSingle();
            console.log("[auth] email:", email, "data:", data, "error:", error);
            token.rol = (data?.activo ? data.rol : "sin_acceso") as "admin" | "viewer" | "sin_acceso";
          } catch (e) {
            console.error("[auth] supabase error:", e);
            token.rol = "sin_acceso";
          }
        }
        return token;
      }

      // Token vigente — devolver sin cambios
      if (Date.now() < (token.accessTokenExpiresAt as number)) {
        return token;
      }

      // Token expirado — refrescar automáticamente
      return refreshAccessToken(token as Record<string, unknown>);
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.email       = token.email       as string;
        session.user.name        = token.name        as string;
        session.user.rol         = token.rol         ?? "sin_acceso";
        session.user.accessToken = token.accessToken as string | undefined;
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
