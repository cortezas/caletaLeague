-- =============================================================================
-- 0015 - La LaLiga de verdad: clasificacion y goleadores
-- =============================================================================
-- QUE RESUELVE
-- Hasta ahora la app solo sabia de la peña. Estas dos tablas guardan datos
-- PUBLICOS de la competicion, tal como los sirve football-data.org:
--
--   competition_standings -> la tabla de LaLiga, una fila por equipo. Alimenta
--                            la pestaña "LaLiga" de /clasificacion y la racha
--                            (ultimos 5) que se pinta en cada fila de partido.
--   competition_scorers   -> el pichichi. Alimenta la ayuda de la pantalla de
--                            pronostico, donde cada jornada hay que elegir
--                            goleadores y hoy se hace de memoria.
--
-- SON UNA FOTO, NO UN HISTORICO
-- Cada pasada del cron reemplaza el contenido entero. No hay `league_id`, no hay
-- fecha en la clave y no se acumulan temporadas: la clasificacion de anteayer no
-- le interesa a nadie y guardarla obligaria a decidir cual se sirve.
--
-- POR QUE NO CUELGAN DE `leagues`
-- Porque no son de ninguna peña. El Barça va primero para las doce personas de
-- La Caleta y para cualquier otra peña que use esta instancia. Meter `league_id`
-- seria guardar veinte veces lo mismo y tener que sincronizarlo veinte veces.
--
-- LA RACHA SE GUARDA TROCEADA
-- La API manda `form` como la cadena "W,D,L,W,W" (y a dia de hoy, con la
-- temporada sin empezar, manda `null`). Aqui entra ya como `text[]` de
-- {W,D,L}: si se guardara la cadena cruda, cada pantalla que la pinte tendria
-- que partirla, y la primera que se olvidara de un `trim` pintaria " W".
-- El troceado se hace UNA vez, en la ingesta, y la restriccion de abajo impide
-- que entre nada que no sea W, D o L.
--
-- QUIEN VE Y QUIEN ESCRIBE
-- Cualquier miembro autenticado LEE las dos (no hay nada privado que filtrar por
-- liga). Escribir, solo `service_role`, que es quien corre /api/sync. La RLS
-- queda activada igual: una tabla publica dentro de un esquema con RLS en todo
-- lo demas no puede ser la unica sin cerrojo, porque el dia que alguien le añada
-- una politica de escritura por error no habria nada mas que la pare.
--
-- REEJECUTABLE: se puede aplicar dos veces seguidas sin cambiar nada.
-- =============================================================================

-- ================================================== competition_standings ===

create table if not exists public.competition_standings (
  team_code     text primary key,
  position      int  not null,
  points        int  not null,
  played_games  int  not null,
  goals_for     int  not null,
  goals_against int  not null,
  -- Ultimos partidos, del mas antiguo al mas reciente, ya troceados.
  -- Vacio cuando la API no da racha, que es el estado normal hasta que se
  -- juegan las primeras jornadas.
  form          text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

-- Las restricciones van en bloques aparte y no dentro del CREATE porque el
-- `if not exists` de arriba se salta la tabla ENTERA cuando ya existe,
-- restricciones incluidas: en un entorno donde la tabla se hubiera creado a
-- mano antes de esta migracion, las comprobaciones no llegarian a existir nunca
-- y nadie se enteraria. `add constraint` no admite `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competition_standings'::regclass
      and conname  = 'competition_standings_code_format'
  ) then
    -- Mismas siglas de 3 letras que matches.home_code y team_squads.team_code.
    -- Sin esto un 'atm' en minuscula entraria sin protestar y luego no casaria
    -- con ningun partido: el sintoma seria una racha vacia inexplicable en la
    -- fila del partido, no un error ruidoso en la ingesta.
    alter table public.competition_standings
      add constraint competition_standings_code_format check (team_code ~ '^[A-Z]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competition_standings'::regclass
      and conname  = 'competition_standings_form_values'
  ) then
    -- `<@` es "contenido en": obliga a que TODOS los elementos sean W, D o L.
    -- Un array vacio esta contenido en cualquiera, asi que "sin racha" pasa.
    -- Esto es lo que garantiza que la pantalla pueda pintar la racha sin
    -- validar nada: si esta en la tabla, es una de las tres letras.
    alter table public.competition_standings
      add constraint competition_standings_form_values
      check (form <@ array['W', 'D', 'L']::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competition_standings'::regclass
      and conname  = 'competition_standings_position_range'
  ) then
    -- 20 equipos. Una posicion 0 o 47 solo puede venir de un fallo de lectura.
    alter table public.competition_standings
      add constraint competition_standings_position_range check (position between 1 and 20);
  end if;
end $$;

comment on table public.competition_standings is
  'Clasificacion real de LaLiga, una fila por equipo. Dato PUBLICO de la '
  'competicion, no de ninguna peña: por eso no hay league_id. La escribe el cron '
  '(/api/sync) con la service role key y reemplaza la foto entera en cada pasada.';

comment on column public.competition_standings.form is
  'Racha, del partido mas antiguo al mas reciente, ya troceada: {W,D,L,W,W}. La '
  'API la manda como la cadena "W,D,L,W,W" o como null; el troceado se hace en '
  'la ingesta (src/lib/football-data/competition.ts), no al leer.';

comment on column public.competition_standings.updated_at is
  'Cuando se trajo esta foto. La UI lo usa para decir desde cuando esta la tabla.';

-- ==================================================== competition_scorers ===

create table if not exists public.competition_scorers (
  -- El puesto en la lista de goleadores, empezando por 1. Es la clave porque la
  -- tabla es una FOTO ordenada: no hay dos primeros. El nombre del jugador NO
  -- sirve de clave (dos homonimos son posibles y la API no garantiza grafia
  -- estable entre pasadas), y un id de la API ataria esta tabla al proveedor.
  rank        int primary key,
  player_name text not null,
  -- `null` cuando el equipo del goleador no es uno de nuestros 20 codigos. Pasa
  -- de verdad: la lista de goleadores puede traer a alguien de un equipo que la
  -- app no conoce. Se guarda el goleador igual, porque su nombre y sus goles son
  -- la ayuda que se pidio; lo que no se hace es ADIVINAR el equipo.
  team_code   text,
  goals       int not null,
  -- `null` cuando la API no da asistencias para ese jugador, que es distinto de
  -- cero. Pintar un 0 donde no hay dato es inventar.
  assists     int,
  updated_at  timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competition_scorers'::regclass
      and conname  = 'competition_scorers_code_format'
  ) then
    alter table public.competition_scorers
      add constraint competition_scorers_code_format
      check (team_code is null or team_code ~ '^[A-Z]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competition_scorers'::regclass
      and conname  = 'competition_scorers_rank_positive'
  ) then
    alter table public.competition_scorers
      add constraint competition_scorers_rank_positive check (rank >= 1);
  end if;
end $$;

comment on table public.competition_scorers is
  'Maximos goleadores de LaLiga, ordenados por `rank`. Dato PUBLICO de la '
  'competicion. La escribe el cron (/api/sync) y reemplaza la foto entera. '
  'ESTA VACIA es un estado normal: con la temporada sin empezar la API devuelve '
  'lista vacia y la pantalla dice que aun no ha marcado nadie.';

comment on column public.competition_scorers.team_code is
  'Uno de nuestros 20 TeamCode, o null si el equipo del goleador no se pudo '
  'emparejar. Nunca se adivina.';

comment on column public.competition_scorers.assists is
  'Asistencias segun la API. `null` = la API no lo da, que NO es cero.';

-- ---------------------------------------------------------------- indices ---
-- Ninguno mas alla de las dos claves primarias, y no es un olvido:
--   - `competition_standings` tiene 20 filas y se lee ENTERA y ordenada por
--     `position`. Un indice sobre 20 filas no lo usaria el planificador ni
--     queriendo, y habria que mantenerlo en cada pasada del cron.
--   - `competition_scorers` se lee entera y ordenada por `rank`, que ya es la
--     clave primaria: el btree de la PK sirve ese `order by` tal cual.

-- ------------------------------------------------------------------- RLS ---
-- Los grants de 0003 fueron `... on all tables in schema public`, que solo
-- alcanza a las tablas que existian entonces. Una tabla nueva necesita los
-- suyos o RLS ni llega a evaluarse: el usuario choca antes con
-- "permission denied" (ese fue el 42501 que documenta la 0010).
--
-- El `revoke` de la primera linea es a proposito y no es decorado: los
-- privilegios por defecto del esquema de Supabase reparten TRUNCATE (y
-- REFERENCES y TRIGGER) a `anon` y a `authenticated` en cada tabla nueva, y
-- TRUNCATE **no pasa por RLS**. Sin revocarlo, cualquiera con la clave publica
-- podria vaciar la clasificacion aunque no tenga ni un select. Se revoca todo y
-- se concede de vuelta EXACTAMENTE lo que hace falta: leer.

alter table public.competition_standings enable row level security;
alter table public.competition_scorers   enable row level security;

revoke all on public.competition_standings from anon, authenticated;
revoke all on public.competition_scorers   from anon, authenticated;

grant select on public.competition_standings to authenticated;
grant select on public.competition_scorers   to authenticated;

-- `using (true)`: son datos publicos de LaLiga. Aqui NO se filtra por peña
-- porque no hay nada que filtrar; el Barça va primero para todo el mundo.
-- `anon` se queda fuera de las politicas a proposito: quien no ha entrado no
-- necesita ver nada de la app, ni siquiera esto.
drop policy if exists competition_standings_select on public.competition_standings;
create policy competition_standings_select on public.competition_standings
  for select to authenticated using (true);

drop policy if exists competition_scorers_select on public.competition_scorers;
create policy competition_scorers_select on public.competition_scorers
  for select to authenticated using (true);

-- NO hay politica de insert/update/delete, ni siquiera para el organizador:
-- esto no lo escribe una persona, lo escribe el cron. Quien escribe es
-- `service_role`, que es BYPASSRLS y no pasa por politicas... pero SI por los
-- grants, asi que necesita los suyos. El `delete` hace falta de verdad: cada
-- pasada retira las filas que ya no estan en la foto nueva.
grant select, insert, update, delete on public.competition_standings to service_role;
grant select, insert, update, delete on public.competition_scorers   to service_role;
