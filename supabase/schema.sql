-- =============================================
-- ARENA CONTROL - Schema Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- =============================================

-- Habilitar extensión para UUIDs
create extension if not exists "pgcrypto";

-- =============================================
-- PARÁMETROS DE CONFIGURACIÓN
-- =============================================
create table if not exists parametros (
  id        uuid primary key default gen_random_uuid(),
  clave     text unique not null,
  valor     numeric not null,
  descripcion text
);

insert into parametros (clave, valor, descripcion) values
  ('densidad_arena',    1.4,  'Densidad arena (ton/m3)'),
  ('densidad_cuarzo',   1.65, 'Densidad cuarzo (ton/m3)'),
  ('factor_pesometro',  0.85, 'Factor corrección pesómetro'),
  ('factor_conos',      0.9,  'Factor de compactación para Conos (AF = Conos×0.9 + Acopio)')
on conflict (clave) do nothing;

-- =============================================
-- DESPACHOS (equivalente a Query1)
-- Importar desde CSV/Excel exportado del ERP
-- =============================================
create table if not exists despachos (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text,
  doc_entry           integer,
  n_documento         integer,
  folio               integer,
  fecha               date not null,
  hora                time not null,
  fecha_hora          timestamptz not null,
  cliente             text,
  nombre              text,
  articulo            text,   -- 'A36LGC'=Arena, 'A37LGC'=Cuarzo, 'A39LGC'=A39
  descripcion         text,
  toneladas           numeric,
  toneladas_confirmadas numeric,
  ton_final           numeric,
  precio              numeric,
  total               numeric,
  patente             text,
  patente_acoplado    text,
  rut_chofer          text,
  nombre_chofer       text,
  bodega_origen       text,
  bodega_destino      text,
  created_at          timestamptz default now()
);

create index if not exists idx_despachos_fecha_hora    on despachos(fecha_hora);
create index if not exists idx_despachos_articulo      on despachos(articulo);

-- =============================================
-- REGISTROS ARENA (equivalente a hoja Datos Arena)
-- =============================================
create table if not exists registros_arena (
  id                  uuid primary key default gen_random_uuid(),

  -- ---- ENTRADA MANUAL ----
  fecha               date not null,
  hora                time not null,
  fecha_hora          timestamptz not null,
  pesometro           numeric not null,
  horometro           numeric not null,
  fierrillo           numeric default 0,   -- col L: despacho como fierrillo (m3)

  -- Volúmenes drone (cols S-U = conos, V-AB = pilas)
  cono_1              numeric default 0,
  cono_2              numeric default 0,
  cono_3              numeric default 0,
  pila_1              numeric default 0,
  pila_2              numeric default 0,
  pila_3              numeric default 0,
  pila_4              numeric default 0,
  pila_5              numeric default 0,
  pila_6              numeric default 0,
  pila_7              numeric default 0,

  -- ---- CALCULADO AUTOMÁTICAMENTE ----
  -- Pesómetro
  diferencia_pesometro  numeric,
  produccion_pesometro  numeric,   -- col F = E × 0.85

  -- Horómetro y horas
  diferencia_horometro  numeric,   -- col H
  horas_reales          numeric,   -- col I = (FechaHora_actual - FechaHora_ant) × 24
  detencion             numeric,   -- col J = I - H

  -- Despachos (calculados vs Query1/despachos)
  despachos_ton         numeric default 0,   -- col M: SUMIFS A36LGC
  cantidad_despachos    integer  default 0,   -- col N

  -- Inventario
  conos                 numeric,   -- col AD = cono_1+cono_2+cono_3
  acopio                numeric,   -- col AE = sum(pilas)
  inventario_m3         numeric,   -- col AF = conos×0.9 + acopio
  inventario_ton        numeric,   -- col AG = inventario_m3 × densidad_arena

  -- Producción
  diferencia_inventario numeric,   -- col AH = AG - AG_ant + fierrillo×densidad
  produccion_drone      numeric,   -- col AN = AH + despachos_ton
  productividad_drone   numeric,   -- col AO = AN / diferencia_horometro
  productividad_pesometro numeric, -- col AK = produccion_pesometro / diferencia_horometro
  productividad_hrs_reales numeric,-- col AP = AN / horas_reales
  diferencia            numeric,   -- col AQ = 1 - productividad_drone/productividad_pesometro

  -- Inventario cancha
  cancha_vieja_ton      numeric,   -- col AR = conos × densidad_arena
  cancha_nueva_ton      numeric,   -- col AS = acopio × densidad_arena

  -- Metadata
  notas                 text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create unique index if not exists idx_arena_fecha_hora on registros_arena(fecha_hora);
create index if not exists idx_arena_fecha on registros_arena(fecha);

-- =============================================
-- REGISTROS CUARZO (equivalente a hoja Datos Cuarzo)
-- =============================================
create table if not exists registros_cuarzo (
  id                  uuid primary key default gen_random_uuid(),

  -- ---- ENTRADA MANUAL ----
  fecha               date not null,
  hora                time not null,
  fecha_hora          timestamptz not null,
  pesometro           numeric,
  horometro           numeric not null,
  cono_1              numeric default 0,   -- col M: volumen principal (m3)
  cono_2              numeric default 0,
  cono_3              numeric default 0,

  -- ---- CALCULADO AUTOMÁTICAMENTE ----
  diferencia_pesometro  numeric,
  produccion_pesometro  numeric,          -- E × 0.85
  diferencia_horometro  numeric,
  horas_reales          numeric,
  detencion             numeric,          -- max(0, I - H)

  despachos_ton         numeric default 0, -- SUMIFS A37LGC
  cantidad_despachos    integer  default 0,

  conos                 numeric,           -- cono_1 + cono_2 + cono_3
  inventario_m3         numeric,           -- = conos
  inventario_ton        numeric,           -- conos × densidad_cuarzo
  diferencia_inventario numeric,

  produccion_drone      numeric,
  productividad_drone   numeric,
  productividad_pesometro numeric,
  productividad_hrs_reales numeric,
  diferencia            numeric,

  notas                 text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create unique index if not exists idx_cuarzo_fecha_hora on registros_cuarzo(fecha_hora);
create index if not exists idx_cuarzo_fecha on registros_cuarzo(fecha);

-- =============================================
-- VISTA DIARIO (Arena)
-- Genera una fila por cada día calendario.
-- Si hay droneo ese día: muestra totales reales.
-- Si no hay droneo: distribuye proporcionalmente el período.
-- =============================================
create or replace view vista_diario_arena as
with
  -- Generar todos los días desde el primer registro hasta hoy
  dias as (
    select generate_series(
      (select min(fecha) from registros_arena),
      current_date,
      interval '1 day'
    )::date as dia
  ),
  -- Asignar a cada día el registro de droneo siguiente (período al que pertenece)
  periodos as (
    select
      d.dia,
      extract(isoyear from d.dia)::int as anio,
      extract(week   from d.dia)::int as semana,
      extract(month  from d.dia)::int as mes,
      r.id              as registro_id,
      r.fecha           as fecha_drone,
      r.fecha_hora      as fecha_hora_drone,
      r.horas_reales,
      r.detencion,
      r.despachos_ton,
      r.cantidad_despachos,
      r.produccion_pesometro,
      r.produccion_drone,
      r.productividad_drone,
      r.productividad_pesometro,
      r.productividad_hrs_reales,
      r.fierrillo,
      r.conos,
      -- días del período = días entre droneo anterior y este droneo
      (r.fecha - lag(r.fecha) over (order by r.fecha))::int as dias_periodo
    from dias d
    join registros_arena r on r.fecha = (
      select min(ra.fecha) from registros_arena ra where ra.fecha >= d.dia
    )
  )
select
  dia                                                                  as fecha,
  semana,
  mes,
  anio,
  -- En el día del droneo muestra el total; en otros días muestra 0
  case when dia = fecha_drone then despachos_ton    else 0 end         as despachos_ton,
  despachos_ton    / greatest(coalesce(dias_periodo, 1), 1)            as despachos_ton_dia,
  case when dia = fecha_drone then cantidad_despachos else 0 end       as viajes,
  cantidad_despachos / greatest(coalesce(dias_periodo, 1), 1)::numeric as viajes_dia,
  case when dia = fecha_drone then detencion         else 0 end        as detencion_total,
  detencion        / greatest(coalesce(dias_periodo, 1), 1)            as detencion_dia,
  case when dia = fecha_drone then produccion_pesometro else 0 end     as produccion_pesometro_total,
  produccion_pesometro / greatest(coalesce(dias_periodo, 1), 1)       as produccion_pesometro_dia,
  case when dia = fecha_drone then produccion_drone   else 0 end       as produccion_drone_total,
  produccion_drone / greatest(coalesce(dias_periodo, 1), 1)           as produccion_drone_dia,
  case when dia = fecha_drone then horas_reales       else 0 end       as horas_reales_total,
  horas_reales     / greatest(coalesce(dias_periodo, 1), 1)           as horas_reales_dia,
  productividad_pesometro,
  productividad_drone,
  productividad_hrs_reales,
  case when dia = fecha_drone then fierrillo          else 0 end       as fierrillo_total,
  fierrillo        / greatest(coalesce(dias_periodo, 1), 1)           as fierrillo_dia,
  case when dia = fecha_drone then conos              else 0 end       as conos_total,
  conos            / greatest(coalesce(dias_periodo, 1), 1)           as conos_dia
from periodos
order by dia;

-- =============================================
-- RLS (Row Level Security) - habilitar autenticación
-- Por ahora: acceso público para desarrollo
-- Cambiar a políticas por usuario en producción
-- =============================================
alter table despachos           enable row level security;
alter table registros_arena     enable row level security;
alter table registros_cuarzo    enable row level security;
alter table parametros          enable row level security;

-- Políticas permisivas (ajustar con auth en producción)
create policy "public_all_despachos"       on despachos       for all using (true) with check (true);
create policy "public_all_arena"           on registros_arena  for all using (true) with check (true);
create policy "public_all_cuarzo"          on registros_cuarzo for all using (true) with check (true);
create policy "public_all_parametros"      on parametros       for all using (true) with check (true);
