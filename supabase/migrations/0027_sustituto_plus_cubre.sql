-- Sustituto +: CUBRE el pronostico, no lo multiplica. Y llega a la clasificacion.
--
-- La migracion 0026 metio `expand_with_subs` en UNA sola de las dos rutas que
-- llevan a `calc_points`, y ademas lo hizo de una forma que paga de mas. Los dos
-- fallos, verificados contra produccion el 21/08/2026:
--
--  1. `public.gameweek_points_calc()` (migracion 0019) pasaba `p.scorers` en
--     crudo. De ahi salen `standings`, `gameweek_points` y `season_dues()`, o sea
--     la clasificacion, el perfil, el head-to-head y QUIEN PAGA LOS 3 EUROS.
--     Resultado: /jornada te daba 10 puntos y /clasificacion 8, y la que manda es
--     la segunda. Dos pantallas de la misma app contandote cosas distintas.
--
--  2. Expandir la lista y contarla tal cual MULTIPLICA el acierto. Pones a Julian
--     Alvarez en un 2-0, lo cambian por Sorloth y marcan los dos: la expansion
--     es {Alvarez, Sorloth}, los dos estan en los goleadores reales, y cobras dos
--     aciertos por UN nombre escrito. Eran 9 puntos donde tocan 7. El Sustituto +
--     de bet365 CUBRE la apuesta, no la duplica: si tu nombre o su relevo marca,
--     tu apuesta esta acertada. Una vez.
--
-- El tope es `least(aciertos, nombres_que_escribiste)`: nunca puedes cobrar mas
-- aciertos de goleador que nombres pusiste. Un doblete pronosticado (el mismo
-- nombre dos veces, que la 0021 permite) sigue pudiendo cobrar dos, porque son
-- dos nombres escritos.

-- ---------------------------------------------------------------------------
-- 1. Aciertos con Sustituto +, CON TOPE.
-- ---------------------------------------------------------------------------
-- El conteo de dentro es el mismo `least(veces_puestas, veces_reales)` por
-- jugador que usa `calc_points` desde la 0022 -- que es lo que ya protege de los
-- duplicados: si el feed manda el mismo cambio dos veces y la cadena saca el
-- relevo repetido, `least` contra las veces que marco de verdad lo corta solo.
create or replace function public.hits_subs(
  p_picks    text[],
  p_real     text[],
  p_match_id uuid
) returns integer
language sql
stable
as $fn$
  with expandido as (
    select public.norm_player(x) as nombre, count(*) as veces
    from unnest(public.expand_with_subs(coalesce(p_picks, '{}'), p_match_id)) x
    where public.norm_player(x) is not null
    group by 1
  ),
  reales as (
    select public.norm_player(x) as nombre, count(*) as veces
    from unnest(coalesce(p_real, '{}')) x
    where public.norm_player(x) is not null
    group by 1
  ),
  brutos as (
    select coalesce(sum(least(e.veces, r.veces)), 0)::int as n
    from expandido e
    join reales r on r.nombre = e.nombre
  ),
  -- Los nombres que escribio la persona, contando repeticiones: es el techo.
  puestos as (
    select count(*)::int as n
    from unnest(coalesce(p_picks, '{}')) x
    where public.norm_player(x) is not null
  )
  select least((select n from brutos), (select n from puestos))::int;
$fn$;

comment on function public.hits_subs(text[], text[], uuid) is
  'Aciertos de goleador/asistente aplicando el Sustituto +, con tope en el numero de nombres puestos. Su espejo en pantalla es hitVia() de src/lib/data/gameweek.ts.';

-- ---------------------------------------------------------------------------
-- 2. Los puntos de un partido, con Sustituto +.
-- ---------------------------------------------------------------------------
-- `calc_points` se deja INTACTA y se REUTILIZA para el marcador y el MVP,
-- pasandole las listas vacias. Asi las reglas del 1X2, del exacto y del MVP
-- siguen viviendo en un solo sitio y esta funcion solo anade lo suyo: los
-- goleadores y los asistentes con la cadena de relevos.
--
-- STABLE y no IMMUTABLE a proposito: esto lee `match_substitutions`.
create or replace function public.calc_points_subs(
  scoring    jsonb,
  p_home     integer, p_away integer, p_mvp text, p_scorers text[], p_assists text[],
  r_home     integer, r_away integer, r_mvp text, r_scorers text[], r_assists text[],
  p_match_id uuid
) returns integer
language sql
stable
as $fn$
  select case
    when r_home is null or r_away is null then 0
    else
      public.calc_points(
        scoring,
        p_home, p_away, p_mvp, '{}'::text[], '{}'::text[],
        r_home, r_away, r_mvp, '{}'::text[], '{}'::text[]
      )
      + coalesce((scoring ->> 'scorer')::int, 0)
        * public.hits_subs(p_scorers, r_scorers, p_match_id)
      + coalesce((scoring ->> 'assist')::int, 0)
        * public.hits_subs(p_assists, r_assists, p_match_id)
  end;
$fn$;

comment on function public.calc_points_subs(jsonb, integer, integer, text, text[], text[], integer, integer, text, text[], text[], uuid) is
  'calc_points + Sustituto +. La usan LAS DOS rutas de lectura: prediction_points y gameweek_points_calc(). Si se toca, se toca scoring.ts.';

-- ---------------------------------------------------------------------------
-- 3. El detalle de cada pronostico.
-- ---------------------------------------------------------------------------
-- De paso se arregla `mvp_hit`, que comparaba en CRUDO mientras `calc_points`
-- normaliza: quien escribia "Mariano Diaz" contra un "Mariano Diaz" real con
-- tilde cobraba los puntos del MVP y veia el chip en gris.
create or replace view public.prediction_points as
  select
    p.id as prediction_id,
    p.member_id,
    p.match_id,
    m.gameweek_id,
    g.league_id,
    g.number as gameweek_number,
    public.calc_points_subs(
      l.scoring,
      p.home, p.away, p.mvp, p.scorers, p.assists,
      m.real_home, m.real_away, m.real_mvp, m.real_scorers, m.real_assists,
      p.match_id
    ) as points,
    m.real_home is not null and p.home = m.real_home and p.away = m.real_away as exact_hit,
    m.real_home is not null
      and sign(p.home - p.away) = sign(m.real_home - m.real_away) as sign_hit,
    m.real_mvp is not null
      and public.norm_player(p.mvp) = public.norm_player(m.real_mvp) as mvp_hit
  from public.predictions p
  join public.matches   m on m.id = p.match_id
  join public.gameweeks g on g.id = m.gameweek_id
  join public.leagues   l on l.id = g.league_id;

-- ---------------------------------------------------------------------------
-- 4. La clasificacion. ESTE era el fallo gordo.
-- ---------------------------------------------------------------------------
-- Cuerpo identico al de la 0019 salvo la llamada: se mantiene SECURITY DEFINER
-- con el search_path fijado, que es lo que evita pagar la RLS fila a fila y lo
-- que arreglo el timeout de 8 s del fin de semana del 15-17/08/2026.
create or replace function public.gameweek_points_calc()
returns table (
  gameweek_id     uuid,
  league_id       uuid,
  gameweek_number integer,
  member_id       uuid,
  base_points     integer,
  pleno_bonus     integer,
  total_points    integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with mis_ligas as (
    select id as league_id from private.user_league_ids() as id
  ),
  puntos as (
    select
      p.member_id,
      m.gameweek_id,
      public.calc_points_subs(
        l.scoring,
        p.home, p.away, p.mvp, p.scorers, p.assists,
        m.real_home, m.real_away, m.real_mvp, m.real_scorers, m.real_assists,
        p.match_id
      ) as points,
      (m.real_home is not null
       and sign(p.home - p.away) = sign(m.real_home - m.real_away)) as sign_hit
    from public.predictions p
    join public.matches   m on m.id = p.match_id
    join public.gameweeks g on g.id = m.gameweek_id
    join public.leagues   l on l.id = g.league_id
    where g.league_id in (select league_id from mis_ligas)
  ),
  por_jornada as (
    select
      g.id      as gameweek_id,
      g.league_id,
      g.number  as gameweek_number,
      l.scoring,
      count(m.id)                                    as match_count,
      count(m.id) filter (where m.status = 'played') as played_count
    from public.gameweeks g
    join public.leagues l on l.id = g.league_id
    left join public.matches m on m.gameweek_id = g.id
    where g.league_id in (select league_id from mis_ligas)
    group by g.id, g.league_id, g.number, l.scoring
  )
  select
    w.gameweek_id,
    w.league_id,
    w.gameweek_number,
    mem.id as member_id,
    coalesce(sum(pt.points), 0)::int as base_points,
    case
      when w.match_count > 0
       and w.played_count = w.match_count
       and count(pt.points) filter (where pt.sign_hit) = w.match_count
        then coalesce((w.scoring ->> 'pleno')::int, 0)
      else 0
    end as pleno_bonus,
    (
      coalesce(sum(pt.points), 0)
      + case
          when w.match_count > 0
           and w.played_count = w.match_count
           and count(pt.points) filter (where pt.sign_hit) = w.match_count
            then coalesce((w.scoring ->> 'pleno')::int, 0)
          else 0
        end
    )::int as total_points
  from por_jornada w
  join public.members mem on mem.league_id = w.league_id
  left join puntos pt
         on pt.gameweek_id = w.gameweek_id
        and pt.member_id   = mem.id
  group by w.gameweek_id, w.league_id, w.gameweek_number, w.match_count,
           w.played_count, w.scoring, mem.id;
$fn$;
