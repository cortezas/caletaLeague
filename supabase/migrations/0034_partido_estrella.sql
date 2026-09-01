-- El partido estrella: uno de los diez vale doble.
--
-- Lo elige el organizador desde el panel. Cambia la estrategia de la jornada
-- entera: ya no da igual donde arriesgas, porque hay un partido donde clavar el
-- marcador vale 6 en vez de 3 y donde fallar el 1X2 duele el doble.
--
-- DONDE VA EL MULTIPLICADOR, y por que no donde parece.
--
-- No entra en `calc_points` ni en `calc_points_n`. `calc_points` es IMMUTABLE y
-- PARALLEL SAFE a proposito, y meterle una lectura de tabla lo romperia; ademas
-- obligaria a cambiar la firma de las tres funciones de puntos y la de
-- `scoreMatch` en TypeScript. Se multiplica EN LOS DOS SITIOS DONDE SE LLAMA:
-- la vista `prediction_points` y el CTE `puntos` de `gameweek_points_calc()`.
-- En los dos, `matches` ya esta en el join, asi que no cuesta ni un scan mas.
--
-- LO QUE NO SE MULTIPLICA:
--  - El pleno. Es plano y depende solo de acertar los 10 signos; doblarlo seria
--    otra regla distinta, no esta.
--  - El desempate del dinero. `season_dues()` desempata por numero de aciertos
--    de 1X2, no por puntos, asi que el x2 no lo toca. Es a proposito: ese
--    desempate mide punteria, no cuanto valia el partido.

alter table public.matches
  add column if not exists multiplicador smallint not null default 1
    check (multiplicador between 1 and 3);

-- Uno y solo uno por jornada. Es una restriccion de verdad y no un acuerdo de
-- palabra: dos partidos dobles en la misma jornada seria otro juego.
create unique index if not exists matches_una_estrella_por_jornada
  on public.matches (gameweek_id) where multiplicador > 1;

comment on column public.matches.multiplicador is
  'Partido estrella: 1 = normal, 2 = vale doble. Lo aplica prediction_points y gameweek_points_calc, no calc_points.';

create or replace view public.prediction_points as
  select
    p.id as prediction_id,
    p.member_id,
    p.match_id,
    m.gameweek_id,
    g.league_id,
    g.number as gameweek_number,
    (public.calc_points_n(
      l.scoring,
      p.home, p.away, p.mvp_n, p.scorers_n, p.assists_n,
      m.real_home, m.real_away, m.real_mvp_n, m.real_scorers_n, m.real_assists_n,
      p.match_id
    ) * coalesce(m.multiplicador, 1)) as points,
    m.real_home is not null and p.home = m.real_home and p.away = m.real_away as exact_hit,
    m.real_home is not null
      and sign(p.home - p.away) = sign(m.real_home - m.real_away) as sign_hit,
    m.real_mvp_n is not null and p.mvp_n = m.real_mvp_n as mvp_hit
  from public.predictions p
  join public.matches   m on m.id = p.match_id
  join public.gameweeks g on g.id = m.gameweek_id
  join public.leagues   l on l.id = g.league_id;

create or replace function public.gameweek_points_calc()
returns table (
  gameweek_id uuid, league_id uuid, gameweek_number integer, member_id uuid,
  base_points integer, pleno_bonus integer, total_points integer
)
language sql stable security definer set search_path = public, pg_temp
as $fn$
  with mis_ligas as (select id as league_id from private.user_league_ids() as id),
  puntos as (
    select
      p.member_id,
      m.gameweek_id,
      (public.calc_points_n(
        l.scoring,
        p.home, p.away, p.mvp_n, p.scorers_n, p.assists_n,
        m.real_home, m.real_away, m.real_mvp_n, m.real_scorers_n, m.real_assists_n,
        p.match_id
      ) * coalesce(m.multiplicador, 1)) as points,
      (m.real_home is not null
       and sign(p.home - p.away) = sign(m.real_home - m.real_away)) as sign_hit
    from public.predictions p
    join public.matches   m on m.id = p.match_id
    join public.gameweeks g on g.id = m.gameweek_id
    join public.leagues   l on l.id = g.league_id
    where g.league_id in (select league_id from mis_ligas)
  ),
  por_jornada as (
    select g.id as gameweek_id, g.league_id, g.number as gameweek_number, l.scoring,
           count(m.id) as match_count,
           count(m.id) filter (where m.status = 'played') as played_count
    from public.gameweeks g
    join public.leagues l on l.id = g.league_id
    left join public.matches m on m.gameweek_id = g.id
    where g.league_id in (select league_id from mis_ligas)
    group by g.id, g.league_id, g.number, l.scoring
  )
  select
    w.gameweek_id, w.league_id, w.gameweek_number, mem.id as member_id,
    coalesce(sum(pt.points), 0)::int as base_points,
    case when w.match_count > 0 and w.played_count = w.match_count
          and count(pt.points) filter (where pt.sign_hit) = w.match_count
         then coalesce((w.scoring ->> 'pleno')::int, 0) else 0 end as pleno_bonus,
    (coalesce(sum(pt.points), 0)
     + case when w.match_count > 0 and w.played_count = w.match_count
             and count(pt.points) filter (where pt.sign_hit) = w.match_count
            then coalesce((w.scoring ->> 'pleno')::int, 0) else 0 end)::int as total_points
  from por_jornada w
  join public.members mem on mem.league_id = w.league_id
  left join puntos pt on pt.gameweek_id = w.gameweek_id and pt.member_id = mem.id
  group by w.gameweek_id, w.league_id, w.gameweek_number, w.match_count,
           w.played_count, w.scoring, mem.id;
$fn$;
