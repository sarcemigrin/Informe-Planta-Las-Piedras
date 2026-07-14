import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ rol: "sin_acceso" });
  }
  try {
    const { data } = await getAdmin()
      .from("usuarios")
      .select("rol, activo")
      .eq("email", session.user.email.toLowerCase())
      .maybeSingle();
    const rol = data?.activo ? data.rol : "sin_acceso";
    return NextResponse.json({ rol });
  } catch {
    return NextResponse.json({ rol: "sin_acceso" });
  }
}
