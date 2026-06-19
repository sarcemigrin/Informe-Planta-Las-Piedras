import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { createClient } from "@supabase/supabase-js";

// Cliente Supabase server-side (con service role o anon key)
function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const handler = NextAuth({
  providers: [
    AzureADProvider({
      clientId:     process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId:     process.env.AZURE_AD_TENANT_ID!,
    }),
  ],

  callbacks: {
    async signIn({ account }) {
      if (account?.provider === "azure-ad") return true;
      return false;
    },

    async jwt({ token, account, profile }) {
      if (account) {
        // Primer login: obtener email y consultar rol en Supabase
        token.email = profile?.email ?? token.email;

        const email = token.email as string | undefined;
        if (email) {
          try {
            const sb = getSupabaseServer();
            const { data } = await sb
              .from("usuarios")
              .select("rol, activo")
              .eq("email", email.toLowerCase())
              .single();

            if (data && data.activo) {
              token.rol = data.rol as "admin" | "viewer";
            } else {
              token.rol = "sin_acceso";
            }
          } catch {
            token.rol = "sin_acceso";
          }
        }
      }
      return token;
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
});

export { handler as GET, handler as POST };
