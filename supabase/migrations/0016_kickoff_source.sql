-- =============================================================================
-- 0016 - Quien manda sobre la hora de un partido (`kickoff_source`)
-- =============================================================================
-- QUE RESUELVE
-- Cuando LaLiga aplaza un partido, football-data.org tarda en enterarse. El
-- 14/08/2026 aplazaron Celta-Osasuna y la API seguia dando la hora vieja
-- (16/08 19:30Z, estado TIMED) horas despues, con una pasada de ingesta forzada
-- a mano de por medio.
--
-- Eso no es cosmetico. TODO cuelga de `kickoff_at`:
--   - `src/lib/data/league.ts` deriva el estado de la fila comparando la hora
--     con `now()`: pasada la hora, el partido sale 'locked';
--   - `savePredictionAction` rechaza con `kickoff_at <= now()`;
--   - la RLS enseña los pronosticos ajenos cuando `kickoff_at <= now()`.
-- O sea que con la hora vieja la peña se queda sin poder pronosticar un partido
-- que aun no se ha jugado, Y ademas se destapan los pronosticos de todos. La
-- unica salida hoy es esperar a que la API reaccione.
--
-- Editar la hora a mano no vale: la ingesta considera a la API la autoridad para
-- todo partido futuro y la pisa en la siguiente pasada, o sea dentro de la hora.
--
-- LA REGLA, LA MISMA DE SIEMPRE EN ESTE PROYECTO: LO MANUAL MANDA.
-- Es el tercer sitio con el mismo patron, a proposito -- `team_squads.source`
-- (0008) y `matches.real_players_source` (0012) --: tres mecanismos distintos
-- para el mismo problema serian tres sitios donde equivocarse.
--
-- POR QUE EL DEFAULT ES 'api' Y NO 'admin'
-- Aqui se invierte respecto a la 0012, y por una razon concreta: las 380 filas
-- que existen tienen la hora que trajo football-data.org, no una que escribiera
-- nadie. Ponerlas en 'admin' congelaria el calendario entero: la ingesta no
-- volveria a corregir un horario en toda la temporada, que es justo lo que se
-- quiere que siga haciendo el resto del tiempo. Solo se protege la fila que el
-- organizador toca de verdad.
--
-- COMO SE VUELVE ATRAS
-- Poniendo la columna en 'api'. La siguiente pasada del cron devuelve la hora
-- oficial y el partido vuelve a seguir a la API. Sin esto, una correccion hecha
-- un martes seguiria mandando en abril.
--
-- LO QUE ESTA MIGRACION NO CAMBIA
-- El sellado de la 0001 sigue por encima de todo: `una hora pasada no se
-- reescribe JAMAS`, la ponga quien la ponga. Un partido que ya empezo no se
-- mueve ni a mano, porque mover hacia adelante la hora de un partido empezado
-- volveria a esconder pronosticos que la peña ya vio.
-- =============================================================================

-- -------------------------------------------------------------- columna ---

alter table public.matches
  add column if not exists kickoff_source text not null default 'api';

-- La restriccion va aparte por lo mismo que en la 0012: `if not exists` se salta
-- la sentencia ENTERA cuando la columna ya existe, restricciones incluidas.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname  = 'matches_kickoff_source_check'
  ) then
    alter table public.matches
      add constraint matches_kickoff_source_check
      check (kickoff_source in ('api', 'admin'));
  end if;
end $$;

comment on column public.matches.kickoff_source is
  'api = kickoff_at lo manda football-data.org y la ingesta lo actualiza en cada '
  'pasada; admin = lo fijo el organizador y la ingesta NO lo toca. Para devolver '
  'el mando a la API basta con volver a poner api. El sellado de horas pasadas '
  '(0001) sigue mandando sobre las dos: un partido empezado no se mueve.';

-- --------------------------------------------------------------- indices ---
-- Ninguno, por lo mismo que en la 0012: son 380 filas y la ingesta ya las lee
-- por `external_id`, que si esta indexado. Un indice aqui no lo usaria el
-- planificador y habria que mantenerlo en cada pasada del cron.

-- ------------------------------------------------------------------- RLS ---
-- Tampoco se toca. `matches` ya trae de la 0003 la politica `matches_write_admin`
-- (solo el organizador de la liga escribe) y de la 0010 los grants de
-- service_role. Las politicas son por fila, no por columna: una columna nueva
-- queda cubierta por las que ya hay.
