-- ============================================================
-- Campañas de otro material
-- Horas de planta usadas para procesar un material distinto al habitual.
-- Se excluyen de diferencia_horometro y horas_reales del droneo (o droneos)
-- cuyo tramo de horómetro las contiene — ver horasCampanaEnVentana en
-- src/lib/calculations.ts. El material queda en pila aparte, por lo que no
-- se ajusta la producción drone; volumen_m3 es solo informativo.
-- ============================================================

create table if not exists campanas (
  id                uuid primary key default gen_random_uuid(),
  planta            text not null default 'arena' check (planta in ('arena', 'cuarzo')),
  material          text not null,
  horometro_inicio  numeric not null,
  horometro_fin     numeric not null,
  volumen_m3        numeric,
  fecha_inicio      date,
  fecha_fin         date,
  observacion       text,
  created_at        timestamptz not null default now(),
  constraint campanas_horometro_ok check (horometro_fin > horometro_inicio)
);

alter table registros_arena add column if not exists horas_campana numeric default 0;

-- RLS: mismo criterio que el resto (lectura anon, escritura solo service role)
alter table campanas enable row level security;

drop policy if exists "anon_read_campanas"     on campanas;
drop policy if exists "no_anon_write_campanas" on campanas;

create policy "anon_read_campanas"
  on campanas for select
  using (true);

create policy "no_anon_write_campanas"
  on campanas for all
  using (false)
  with check (false);

-- ---- v2 (formulario de campañas en Nuevo Registro) ----
-- Pesómetro de campaña (opcional) y unicidad para no duplicar una campaña
-- si se reintenta el guardado del droneo.
alter table campanas add column if not exists pesometro_inicio numeric;
alter table campanas add column if not exists pesometro_fin    numeric;
alter table campanas drop constraint if exists campanas_pesometro_ok;
alter table campanas add constraint campanas_pesometro_ok
  check ((pesometro_inicio is null and pesometro_fin is null) or pesometro_fin > pesometro_inicio);
alter table campanas drop constraint if exists campanas_unica;
alter table campanas add constraint campanas_unica unique (planta, horometro_inicio, horometro_fin);
alter table registros_arena add column if not exists pesometro_campana numeric default 0;

-- ---- Registrar la campaña (completar material y volumen) ----
-- Campaña oct-2026: 18540.21 → 18556.93 = 16.72 h. Parte justo en el droneo
-- del 2026-10-08 07:51 (horómetro 18540.21), así que solo afecta al droneo siguiente.
-- insert into campanas (planta, material, horometro_inicio, horometro_fin, volumen_m3, fecha_inicio, observacion)
-- values ('arena', '<material>', 18540.21, 18556.93, <m3>, '2026-10-08', '<obs>');
