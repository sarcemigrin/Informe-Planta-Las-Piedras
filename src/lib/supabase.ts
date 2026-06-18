import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
