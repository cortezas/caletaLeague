-- =============================================================================
-- 0012 - De donde salen los goleadores y los asistentes (`real_players_source`)
-- =============================================================================
-- QUE RESUELVE
-- Hasta ahora `matches.real_scorers` y `matches.real_assists` solo los escribia
-- el organizador a mano: la 0011 lo dice con todas las letras ("los mete el
-- organizador: la API gratuita no los da"). Con Highlightly entra una segunda
-- fuente, y en cuanto hay dos fuentes hace falta saber CUAL escribio cada fila.
-- Sin eso, la siguiente pasada del cron no puede distinguir "esto lo puso Curro
-- despues del partido" de "esto lo traje yo", y acabaria pisando el trabajo del
-- organizador en silencio. Ese es el bug caro: nadie lo ve hasta que la
-- clasificacion esta mal.
--
-- ES EL MISMO PATRON QUE `team_squads.source` (migracion 0008), a proposito: dos
-- mecanismos distintos para el mismo problema serian dos sitios donde
-- equivocarse. Quien entienda uno entiende el otro.
--
-- LA REGLA, EN UNA FRASE: LO MANUAL MANDA.
-- La ingesta SOLO puede escribir en una fila cuando las dos listas estan vacias
-- y la fila no la escribio ya la API:
--
--   update public.matches
--      set real_scorers = ..., real_assists = ..., real_players_source = 'api'
--    where id = ...
--      and real_players_source <> 'api'
--      and cardinality(real_scorers) = 0
--      and cardinality(real_assists) = 0;
--
-- Las tres condiciones del WHERE son la proteccion, y tienen que evaluarse en
-- Postgres y no en memoria del proceso: entre que la ingesta lee y escribe cabe
-- justo el instante en que el organizador da a guardar. Si el UPDATE afecta a 0
-- filas, el organizador gano la carrera, que es exactamente lo que tiene que
-- pasar.
--
-- POR QUE EL DEFAULT ES 'admin' Y NO 'api'
-- Las 380 filas que ya existen se escribieron (o se escribiran) a mano, porque
-- cuando se aplicaron las migraciones anteriores la API de eventos no existia en
-- este proyecto. Ponerles 'api' seria declarar que las trajo un robot que nunca
-- paso por ahi, y ademas dejaria a la ingesta creyendose duena de datos que no
-- escribio. Con 'admin' por defecto, una fila que ya tenga goleadores metidos a
-- mano queda protegida por partida doble: por el `source` y por el
-- `cardinality(...) = 0`.
--
-- Un partido SIN goleadores y con `source = 'admin'` (el caso normal de una fila
-- recien sembrada) NO esta protegido contra nada, y es correcto: no hay trabajo
-- de nadie que proteger ahi. Lo unico que se defiende es lo que alguien escribio.
--
-- POR QUE TAMBIEN SE MARCA UN 0-0
-- Un partido que acaba sin goles se cierra con las dos listas vacias y
-- `source = 'api'`. Si no se marcara, la ingesta lo veria "sin goleadores" en
-- cada pasada y gastaria una peticion por pasada en un partido que ya esta
-- resuelto. Con 100 peticiones AL DIA de cuota, esa fuga se come el presupuesto
-- en una tarde. Ver docs/EVENTOS.md.
--
-- QUE NO TOCA ESTA MIGRACION
-- Ni RLS, ni `calc_points`, ni las tres vistas, ni `real_mvp`. El MVP es un
-- invento de la peña que no da ninguna API y sigue siendo territorio exclusivo
-- del organizador.
-- =============================================================================

-- -------------------------------------------------------------- columna ---

alter table public.matches
  add column if not exists real_players_source text not null default 'admin';

-- La restriccion va en un DO aparte y no dentro del ADD COLUMN de arriba porque
-- el `if not exists` se salta la sentencia ENTERA cuando la columna ya existe,
-- restricciones incluidas: en un entorno donde la columna se anadio a mano antes
-- de esta migracion, la comprobacion no habria llegado a existir nunca.
-- `add constraint` no admite `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname  = 'matches_real_players_source_check'
  ) then
    alter table public.matches
      add constraint matches_real_players_source_check
      check (real_players_source in ('api', 'admin'));
  end if;
end $$;

comment on column public.matches.real_players_source is
  'api = real_scorers/real_assists los trajo Highlightly (src/lib/highlightly); '
  'admin = los metio el organizador a mano. La ingesta solo escribe cuando el '
  'valor NO es api y las dos listas estan vacias. real_mvp queda fuera: no lo '
  'da ninguna API.';

-- --------------------------------------------------------------- indices ---
-- NO se crea ninguno. La consulta de partidos pendientes filtra por
-- gameweek_id (ya cubierto por `matches_gameweek_id_idx`, migracion 0001) y
-- luego por status y por esta columna sobre 380 filas como mucho. Un indice
-- sobre una tabla de 380 filas no lo usaria el planificador ni queriendo, y
-- habria que mantenerlo en cada escritura de la ingesta.

-- ------------------------------------------------------------------- RLS ---
-- Tampoco se toca. `matches` ya tiene sus politicas de 0003 y sus grants de
-- 0010 (`grant select, insert, update, delete on public.matches to service_role`),
-- y los grants de tabla alcanzan a las columnas nuevas sin hacer nada mas. Una
-- columna nueva en una tabla que ya existe no necesita politicas propias: las
-- politicas son por fila, no por columna.
