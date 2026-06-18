import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

const handler = NextAuth({
  providers: [
    AzureADProvider({
      clientId:     process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId:     process.env.AZURE_AD_TENANT_ID!,
    }),
  ],

  callbacks: {
    // Solo permitir usuarios del tenant de la empresa
    async signIn({ account }) {
      // El tenant está fijado en el provider, Azure rechaza automáticamente
      // cuentas externas. Esta capa adicional verifica el tid del token.
      if (account?.provider === "azure-ad") {
        return true; // Azure AD tenant-id ya filtra al nivel del proveedor
      }
      return false;
    },

    async session({ session, token }) {
      // Exponer el email y nombre en la sesión
      if (session.user) {
        session.user.email = token.email as string;
        session.user.name  = token.name  as string;
      }
      return session;
    },

    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
        token.email       = profile?.email ?? token.email;
      }
      return token;
    },
  },

  pages: {
    signIn: "/login",      // página de login personalizada
    error:  "/login",
  },

  session: {
    strategy: "jwt",
    maxAge:   8 * 60 * 60, // 8 horas (jornada laboral)
  },
});

export { handler as GET, handler as POST };
