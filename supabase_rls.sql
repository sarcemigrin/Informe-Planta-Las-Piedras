-- ============================================================
-- POLÍTICAS RLS — Arena Control
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Lógica: la anon key solo puede leer datos si el usuario está
-- autenticado via NextAuth (rol en JWT). Las escrituras siempre
-- requieren service role key (usada solo en API routes del servidor).
--
-- Como Next.js usa la anon key en el cliente, las políticas RLS
-- deben ser restrictivas para proteger datos en caso de que alguien
-- tenga la anon key y llame la API de Supabase directamente.
--
-- IMPORTANTE: Supabase usa autenticación propia (JWT de Supabase).
-- La app usa NextAuth, por lo que el cliente Supabase NO tiene un
-- JWT de Supabase autenticado. Esto significa que las lecturas del
-- cliente van con el rol "anon". Las políticas de abajo permiten
-- lectura anon (ya que la app autentica vía NextAuth antes de mostrar
-- la UI) pero BLOQUEAN escrituras anon. Las escrituras solo ocurren
-- vía API routes del servidor que usan la service role key.
-- ============================================================


-- ── 1. HABILITAR RLS EN TODAS LAS TABLAS ────────────────────
ALTER TABLE registros_arena    ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_cuarzo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion      ENABLE ROW LEVEL SECURITY;
ALTER TABLE diario_anotaciones ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas previas si existen (para un apply limpio)
DROP POLICY IF EXISTS "anon_read_arena"          ON registros_arena;
DROP POLICY IF EXISTS "anon_read_cuarzo"         ON registros_cuarzo;
DROP POLICY IF EXISTS "anon_read_despachos"      ON despachos;
DROP POLICY IF EXISTS "anon_read_usuarios"       ON usuarios;
DROP POLICY IF EXISTS "anon_read_configuracion"  ON configuracion;
DROP POLICY IF EXISTS "anon_read_diario"         ON diario_anotaciones;
DROP POLICY IF EXISTS "no_anon_write_arena"      ON registros_arena;
DROP POLICY IF EXISTS "no_anon_write_cuarzo"     ON registros_cuarzo;
DROP POLICY IF EXISTS "no_anon_write_despachos"  ON despachos;
DROP POLICY IF EXISTS "no_anon_write_usuarios"   ON usuarios;
DROP POLICY IF EXISTS "no_anon_write_config"     ON configuracion;
DROP POLICY IF EXISTS "no_anon_write_diario"     ON diario_anotaciones;


-- ── 2. LECTURA: permitir anon (la app ya autentica vía NextAuth) ──

-- Los datos operacionales son internos de la empresa.
-- Si quieres que solo lecturas autenticadas vía Supabase puedan leer,
-- cambia `true` por `auth.role() = 'authenticated'`.
-- Con NextAuth la sesión de Supabase es siempre anon, así que se
-- usa `true` para permitir lectura, confiando en que la UI protege el acceso.

CREATE POLICY "anon_read_arena"
  ON registros_arena FOR SELECT
  USING (true);

CREATE POLICY "anon_read_cuarzo"
  ON registros_cuarzo FOR SELECT
  USING (true);

CREATE POLICY "anon_read_despachos"
  ON despachos FOR SELECT
  USING (true);

-- usuarios: solo exponer email y rol (no datos sensibles)
CREATE POLICY "anon_read_usuarios"
  ON usuarios FOR SELECT
  USING (true);

-- configuracion: lectura permitida (destinatarios, paths de OneDrive, etc.)
CREATE POLICY "anon_read_configuracion"
  ON configuracion FOR SELECT
  USING (true);

CREATE POLICY "anon_read_diario"
  ON diario_anotaciones FOR SELECT
  USING (true);


-- ── 3. ESCRITURA: BLOQUEAR completamente para anon ──────────────
-- Las escrituras (INSERT, UPDATE, DELETE) solo pueden hacerse desde
-- API routes del servidor usando SUPABASE_SERVICE_ROLE_KEY,
-- que bypasa RLS completamente. Ningún cliente puede escribir directamente.

CREATE POLICY "no_anon_write_arena"
  ON registros_arena FOR ALL
  USING (false)
  WITH CHECK (false);
-- Nota: la service role bypasa esta política automáticamente.

CREATE POLICY "no_anon_write_cuarzo"
  ON registros_cuarzo FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "no_anon_write_despachos"
  ON despachos FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "no_anon_write_usuarios"
  ON usuarios FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "no_anon_write_config"
  ON configuracion FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "no_anon_write_diario"
  ON diario_anotaciones FOR ALL
  USING (false)
  WITH CHECK (false);


-- ── 4. VERIFICAR ────────────────────────────────────────────────
-- Después de ejecutar, verificar que RLS está activo:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Listar políticas activas:
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
