-- =============================================================================
-- 0008 - Plantillas por equipo (`team_squads`)
-- =============================================================================
-- Que resuelve: el plan gratuito de football-data.org SI da las plantillas de
-- los 20 equipos (lo que no da son goleadores por partido ni alineaciones), asi
-- que el editor de pronostico puede pintar chips de jugador en vez de obligar a
-- escribir a ciegas.
--
-- POR QUE LA TABLA ES POR LIGA Y NO GLOBAL
-- El organizador puede corregir una plantilla a mano desde el panel de admin, y
-- esa correccion es SUYA: no tiene por que imponersela a otra peña que use la
-- misma instancia. La clave primaria es (league_id, team_code) por eso, y no
-- solo team_code.
--
-- LA REGLA DEL `source` (esto es lo importante)
-- La ingesta escribe con source='api'. Si el organizador la corrigio a mano, la
-- fila queda con source='admin' y la ingesta NO la puede pisar. El upsert de la
-- ingesta tiene que llevar, literalmente:
--
--   insert into public.team_squads (league_id, team_code, players, source)
--   values (..., 'api')
--   on conflict (league_id, team_code) do update
--     set players = excluded.players, updated_at = now()
--     where public.team_squads.source = 'api';
--
-- El `where` del DO UPDATE es lo que protege la correccion manual. Sin el, la
-- siguiente pasada de la ingesta borra el trabajo del organizador en silencio.
--
-- Una plantilla que falta NO es un error: el editor cae solo en modo texto
-- libre, que sigue disponible SIEMPRE (la ficha del Atletico en la API trae 5
-- jugadores, y a otros equipos les faltan fichajes).
-- =============================================================================

create table if not exists public.team_squads (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  team_code  text not null,
  players    text[] not null default '{}',
  source     text not null default 'api' check (source in ('api', 'admin')),
  updated_at timestamptz not null default now(),

  primary key (league_id, team_code)
);

-- Mismas siglas de 3 letras que matches.home_code / away_code. Sin esto un
-- 'atm' en minuscula entraria sin protestar y luego no casaria NUNCA con ningun
-- partido: el sintoma seria una plantilla vacia inexplicable en la pantalla de
-- pronostico en vez de un error ruidoso en la ingesta.
--
-- Va en un DO aparte y no dentro del CREATE porque el `if not exists` de arriba
-- se salta la tabla ENTERA cuando ya existe, restricciones incluidas: en un
-- entorno donde la tabla se creo a mano antes de esta migracion, la comprobacion
-- nunca habria llegado a existir. `add constraint` no admite `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.team_squads'::regclass
      and conname  = 'team_squads_code_format'
  ) then
    alter table public.team_squads
      add constraint team_squads_code_format check (team_code ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on table public.team_squads is
  'Plantillas por equipo y por liga. source=api las escribe la ingesta; '
  'source=admin las corrige el organizador y la ingesta no las pisa.';

comment on column public.team_squads.source is
  'api = viene de football-data.org; admin = corregida a mano por el '
  'organizador. La ingesta solo puede sobrescribir filas con source=api.';

-- ---------------------------------------------------------------- indices ---
-- La clave primaria crea un btree sobre (league_id, team_code) que ya sirve a
-- los DOS accesos que existen: "toda la plantilla de mi liga" (prefijo
-- league_id) y "la plantilla de este equipo en mi liga" (clave completa). Un
-- indice extra sobre league_id seria una copia del prefijo: ocupa, se mantiene
-- en cada escritura y no lo usaria nadie. Por eso aqui no hay ninguno mas.

-- --------------------------------------------------------------- trigger ---
-- Reutiliza el helper de 0001. Sin esto `updated_at` se queda en la fecha del
-- insert y la ingesta no puede distinguir una plantilla fresca de una vieja.

drop trigger if exists team_squads_touch_updated_at on public.team_squads;
create trigger team_squads_touch_updated_at
  before update on public.team_squads
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------- RLS ---
-- Los grants de 0003 fueron `on all tables in schema public`, que solo alcanza
-- a las tablas que existian entonces. Una tabla nueva necesita los suyos o RLS
-- ni llega a evaluarse: el usuario choca antes con "permission denied".

alter table public.team_squads enable row level security;

grant select, insert, update, delete on public.team_squads to authenticated;

-- Leer: cualquier miembro de la liga. Los mismos dos patrones de rendimiento
-- que en 0003: `(select auth.uid())` envuelto y `= any (array(select ...))`.
drop policy if exists team_squads_select on public.team_squads;
create policy team_squads_select on public.team_squads for select to authenticated
using ( league_id = any (array(select private.user_league_ids())) );

-- Escribir: SOLO el organizador. La ingesta no pasa por aqui, va con la service
-- role key, que salta RLS por definicion.
drop policy if exists team_squads_write_admin on public.team_squads;
create policy team_squads_write_admin on public.team_squads for all to authenticated
using      ( league_id = any (array(select private.admin_league_ids())) )
with check ( league_id = any (array(select private.admin_league_ids())) );
