import { createClient } from "@supabase/supabase-js";

// Cliente sin genérico Database para evitar incompatibilidades de tipos con Supabase v2.
// Los tipos de las interfaces (RegistroArena, etc.) se usan directamente con 'as' donde sea necesario.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: ReturnType<typeof createClient<any>> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getClient(): ReturnType<typeof createClient<any>> {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _client = createClient(url, key);
  }
  return _client;
}

// Proxy: el cliente se crea solo cuando se usa por primera vez (en el browser o en runtime)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = new Proxy({} as ReturnType<typeof createClient<any>>, {
  get(_target, prop: string | symbol) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getClient() as any)[prop];
  },
});
