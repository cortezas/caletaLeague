-- =============================================================================
-- 0019 - La clasificacion dejaba de cargar en cuanto se jugaban partidos
-- =============================================================================
-- QUE PASO
-- El 15-17/08/2026, con la jornada 1 ya jugada, /clasificacion y /perfil dejaron
-- de cargar para toda la peña. En pantalla salia "Sin conexion", que es lo que
-- pinta el error boundary ante CUALQUIER fallo del servidor.
--
-- El fallo real era `57014: canceling statement due to statement timeout`. El
-- rol `authenticated` tiene `statement_timeout = 8s` y la consulta de
-- `standings` llego a 7880 ms medidos: cruzo el limite y Postgres la mato.
--
-- POR QUE JUSTO ESE FIN DE SEMANA
-- Hasta entonces no habia ni un partido jugado, asi que `prediction_points` no
-- tenia nada que calcular y todo iba rapido. En cuanto entraron resultados, el
-- plan real (EXPLAIN ANALYZE con el rol authenticated) enseño esto:
--
--   Index Scan matches_pkey ... (loops=1900)
--     Filter: private.gameweek_league_id(gameweek_id) = ANY (...)
--   Index Scan gameweeks_pkey ... (loops=1900)
--   Index Scan leagues_pkey ... (loops=1900)
--
-- O sea ~5.700 llamadas a funciones de RLS, cada una con su propia consulta,
-- para devolver 14 filas. Y con 75 pronosticos. En mayo habra ~5.700: esto no
-- se arregla subiendo el timeout, hay que quitar el trabajo.
--
-- DE DONDE SALE LA MULTIPLICACION
-- `gameweek_points` cruza las 38 jornadas por los 14 miembros (532 filas) y para
-- CADA combinacion vuelve a mirar `prediction_points`, que a su vez pasa por
-- `predictions` -> `matches` -> `gameweeks` -> `leagues`, y en cada salto la RLS
-- evalua sus funciones fila a fila.
--
-- LA SOLUCION
-- Calcular los puntos UNA vez dentro de una funcion `security definer`, que no
-- paga RLS por fila, y acotarla a mano a las peñas del que pregunta. Las vistas
-- mantienen su nombre y sus columnas, asi que la aplicacion no se entera.
--
-- POR QUE ESTO NO ABRE UN AGUJERO
-- Lo que se salta la RLS es el AGREGADO, nunca el detalle:
--   - un partido sin resultado suma 0, asi que ningun pronostico ajeno se
--     traduce en puntos antes de que el partido empiece;
--   - el bonus de pleno solo entra con la jornada ENTERA jugada;
--   - la funcion filtra por `private.user_league_ids()`, o sea que nadie ve la
--     clasificacion de otra peña.
-- Es exactamente la informacion que la clasificacion enseña por definicion.
--
-- `prediction_points` NO se toca y sigue con `security_invoker`. Esa si expone
-- el pronostico de cada uno, y ahi la regla de "nadie ve tu pronostico antes del
-- pitido inicial" tiene que seguir aplicandose fila a fila.
-- =============================================================================

-- ------------------------------------------------- puntos por jornada ---

create or replace function public.gameweek_points_calc()
returns table (
  gameweek_id     uuid,
  league_id       uuid,
  gameweek_number int,
  member_id       uuid,
  base_points     int,
  pleno_bonus     int,
  total_points    int
)
language sql
stable
security definer
-- `search_path` fijo: sin esto, quien llame podria anteponer un esquema propio y
-- secuestrar los nombres de tabla dentro de una funcion que corre como owner.
set search_path = public, pg_temp
as $$
  -- `private.user_league_ids()` devuelve SETOF uuid, no un array: se consulta
  -- como una tabla. Se materializa una vez aqui y se reutiliza en los dos CTE,
  -- que es justo lo que evita volver a preguntarlo fila a fila.
  with mis_ligas as (
    select id as league_id from private.user_league_ids() as id
  ),
  -- Una sola pasada por los pronosticos de la peña, sin RLS por fila. El filtro
  -- de liga va explicito aqui: es lo que sustituye a la politica.
  puntos as (
    select
      p.member_id,
      m.gameweek_id,
      public.calc_points(
        l.scoring,
        p.home, p.away, p.mvp, p.scorers, p.assists,
        m.real_home, m.real_away, m.real_mvp, m.real_scorers, m.real_assists
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
$$;

comment on function public.gameweek_points_calc is
  'Puntos por jornada y miembro de las peñas de quien llama, en UNA pasada. '
  'security definer para no pagar la RLS fila a fila: el filtro de liga va '
  'explicito con private.user_league_ids(). Ver la cabecera de la migracion 0019.';

-- Solo la usan las vistas de aqui abajo, pero PostgREST necesita el grant para
-- que la vista sea consultable por un usuario normal.
grant execute on function public.gameweek_points_calc() to authenticated, anon, service_role;

-- ------------------------------------------------------------- vistas ---
-- Mismos nombres y mismas columnas que antes: la aplicacion no cambia.
--
-- `security_invoker` deja de pintar nada aqui (quien acota es la funcion), pero
-- se deja puesto para que nadie lea esta vista como "vista sin RLS" y la copie
-- para otra cosa.

create or replace view public.gameweek_points
with (security_invoker = true) as
select gameweek_id, league_id, gameweek_number, member_id, base_points, pleno_bonus, total_points
from public.gameweek_points_calc();

create or replace view public.standings
with (security_invoker = true) as
select
  mem.league_id,
  mem.id as member_id,
  mem.display_name,
  mem.avatar_color,
  coalesce(sum(gp.total_points), 0)::int as total_points,
  rank() over (
    partition by mem.league_id
    order by coalesce(sum(gp.total_points), 0) desc
  )::int as position,
  -- Al final, como en la 0018: `create or replace view` solo admite añadir
  -- columnas por ahi.
  mem.avatar_url
from public.members mem
left join public.gameweek_points_calc() gp on gp.member_id = mem.id
group by mem.league_id, mem.id, mem.display_name, mem.avatar_color, mem.avatar_url;
