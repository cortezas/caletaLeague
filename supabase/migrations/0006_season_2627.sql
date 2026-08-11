-- =============================================================================
-- 0006 - Temporada 2026/27: identidad externa y comparacion tolerante de nombres
-- =============================================================================
-- Dos cosas, sin relacion entre si mas que la temporada que las trae:
--
--   1. `matches.external_id`, para que la ingesta desde football-data.org
--      (src/lib/football-data/) pueda hacer upsert idempotente y no duplique
--      los 380 partidos cada vez que corre.
--
--   2. Comparacion TOLERANTE de nombres de jugador en `calc_points`. El plan
--      gratuito de football-data.org NO da jugadores: la peña los escribe a mano
--      y nadie va a poner los acentos igual. "Vinicius" y "Vinícius" son el mismo
--      jugador, y "Kike  Garcia" con dos espacios tambien.
--
-- La regla de puntuacion NO cambia: exacto y 1X2 siguen siendo excluyentes.
-- =============================================================================

-- ------------------------------------------------------------ external_id ---
-- Se hace en dos pasos en vez de `add column ... unique` porque asi es
-- reejecutable de verdad: si la columna ya existiera sin indice, el ALTER se
-- saltaria tambien la restriccion y nos quedariamos sin unicidad.
--
-- Un indice unico (y no una constraint) basta para `on conflict (external_id)`:
-- la inferencia de ON CONFLICT trabaja sobre indices. Y admite varios NULL, que
-- es justo lo que necesita el seed, que siembra el calendario sin ids externos.

alter table public.matches add column if not exists external_id text;

create unique index if not exists matches_external_id_key
  on public.matches (external_id);

comment on column public.matches.external_id is
  'Id del partido en la fuente externa (football-data.org). NULL en las filas '
  'sembradas por seed.sql; la ingesta lo estampa en su primera pasada.';

-- ------------------------------------------------------------- unaccent ---

create extension if not exists unaccent;

-- ----------------------------------------------------------- norm_player ---
-- Espejo SQL de normalizePlayer() en src/lib/squads.ts: minusculas, sin
-- diacriticos, espacios colapsados, trim.
--
-- SOBRE LA VOLATILIDAD (esto importa)
-- `calc_points` es immutable, y una funcion immutable no deberia apoyarse en
-- nada que no lo sea. Se usa la forma de DOS argumentos `unaccent('unaccent', x)`
-- porque es la unica que PostgreSQL 17 marca IMMUTABLE (en 15/16 ambas siguen
-- siendo STABLE). Como PostgreSQL no verifica la volatilidad declarada, aqui se
-- declara `immutable` a conciencia: el diccionario `unaccent` es fijo y no
-- depende de datos ni de la sesion, asi que la promesa se cumple de hecho aunque
-- el catalogo de la version vieja diga otra cosa. El unico efecto colateral en
-- 15/16 es que el planificador no puede inlinear la funcion.
--
-- `set search_path` porque la extension vive en `public` en local pero en
-- `extensions` en Supabase, y sin esto la resolucion de `unaccent` depende del
-- search_path de quien llame.
--
-- Devuelve NULL para NULL y tambien para cadena vacia o solo espacios: dos MVP
-- en blanco NO son "el mismo jugador", y sin el nullif() empatarian a ''.

create or replace function public.norm_player(p_name text) returns text
language sql immutable parallel safe
set search_path = public, extensions, pg_temp
as $$
  select nullif(
    btrim(regexp_replace(
      lower(unaccent('unaccent'::regdictionary, coalesce(p_name, ''))),
      '\s+', ' ', 'g'
    )),
    ''
  )
$$;

comment on function public.norm_player is
  'Espejo SQL de normalizePlayer() en src/lib/squads.ts. NULL si queda vacio.';

grant execute on function public.norm_player(text) to anon, authenticated;

-- ------------------------------------------------------------ calc_points ---
-- Misma firma que en 0004, asi que las tres vistas siguen valiendo sin tocarlas
-- (solo se recrea `prediction_points`, y por otro motivo: su flag `mvp_hit`).
-- Lo unico que cambia es COMO se comparan MVP y goleadores.

create or replace function public.calc_points(
  scoring  jsonb,
  p_home   int,  p_away int,  p_mvp text, p_scorers text[],
  r_home   int,  r_away int,  r_mvp text, r_scorers text[]
) returns int
language sql immutable parallel safe as $$
  select case
    -- Partido sin resultado: aun no puntua.
    when r_home is null or r_away is null then 0
    else
      -- Marcador: exacto y 1X2 son EXCLUYENTES. Un exacto suma 3, no 3 + 1.
      (case
         when p_home = r_home and p_away = r_away
           then coalesce((scoring ->> 'exact')::int, 0)
         when sign(p_home - p_away) = sign(r_home - r_away)
           then coalesce((scoring ->> 'x2')::int, 0)
         else 0
       end)
      -- MVP, comparado en forma normalizada.
      + (case
           when public.norm_player(p_mvp) is not null
            and public.norm_player(p_mvp) = public.norm_player(r_mvp)
             then coalesce((scoring ->> 'mvp')::int, 0)
           else 0
         end)
      -- Goleadores: uno por cada acierto, sin penalizar los fallos.
      -- INTERSECT deduplica, igual que el Set del espejo en TypeScript, y al
      -- normalizar ANTES tambien deduplica "Garcia" contra "García".
      + coalesce((scoring ->> 'scorer')::int, 0) * (
          select count(*)::int
          from (
                 select public.norm_player(s) as n
                 from unnest(p_scorers) as s
                 where public.norm_player(s) is not null
                 intersect
                 select public.norm_player(s)
                 from unnest(r_scorers) as s
                 where public.norm_player(s) is not null
               ) as hit
        )
  end
$$;

comment on function public.calc_points is
  'Espejo SQL de scoreMatch() en src/lib/scoring.ts. Exact y x2 son excluyentes. '
  'MVP y goleadores se comparan con public.norm_player (tolerante a acentos).';

-- ------------------------------------- vista: por prediccion (solo mvp_hit) ---
-- Se recrea para que el flag `mvp_hit` que pinta la UI use el mismo criterio
-- tolerante que la puntuacion. Si no, un acierto con acento sumaria 2 puntos
-- pero saldria en gris en la pantalla de detalle.
--
-- Mismos nombres, mismo orden y mismos tipos de columna, asi que
-- `gameweek_points` y `standings`, que cuelgan de esta, no se enteran.

create or replace view public.prediction_points
with (security_invoker = true) as
select
  p.id          as prediction_id,
  p.member_id,
  p.match_id,
  m.gameweek_id,
  g.league_id,
  g.number      as gameweek_number,
  public.calc_points(
    l.scoring,
    p.home, p.away, p.mvp, p.scorers,
    m.real_home, m.real_away, m.real_mvp, m.real_scorers
  ) as points,
  (m.real_home is not null
   and p.home = m.real_home and p.away = m.real_away) as exact_hit,
  (m.real_home is not null
   and sign(p.home - p.away) = sign(m.real_home - m.real_away)) as sign_hit,
  (public.norm_player(m.real_mvp) is not null
   and public.norm_player(p.mvp) = public.norm_player(m.real_mvp)) as mvp_hit
from public.predictions p
join public.matches   m on m.id = p.match_id
join public.gameweeks g on g.id = m.gameweek_id
join public.leagues   l on l.id = g.league_id;

grant select on public.prediction_points to authenticated;
