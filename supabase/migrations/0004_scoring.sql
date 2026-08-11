-- =============================================================================
-- 0004 - Calculo de puntos y vistas de clasificacion
-- =============================================================================
-- El calculo vive aqui, NUNCA en el cliente: cuando el administrador cambia la
-- puntuacion, toda la temporada tiene que recalcularse de forma consistente.
--
-- `public.calc_points` es el espejo exacto de `scoreMatch()` en
-- src/lib/scoring.ts. Si se toca una, se toca la otra.
--
-- Las vistas llevan `security_invoker = true` OBLIGATORIAMENTE. Sin eso se
-- evaluarian con los permisos del propietario, saltandose RLS, y cualquier
-- usuario veria la clasificacion de todas las peñas. Y por eso mismo aqui no
-- hay ninguna vista materializada: las matviews no soportan RLS.
-- =============================================================================

-- ------------------------------------------------------------ calc_points ---

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
      -- MVP.
      + (case
           when p_mvp is not null and p_mvp = r_mvp
             then coalesce((scoring ->> 'mvp')::int, 0)
           else 0
         end)
      -- Goleadores: uno por cada acierto, sin penalizar los fallos.
      -- INTERSECT deduplica, igual que el Set del espejo en TypeScript.
      + coalesce((scoring ->> 'scorer')::int, 0) * (
          select count(*)::int
          from (select unnest(p_scorers) intersect select unnest(r_scorers)) as hit
        )
  end
$$;

comment on function public.calc_points is
  'Espejo SQL de scoreMatch() en src/lib/scoring.ts. Exact y x2 son excluyentes.';

-- --------------------------------------------------- vista: por prediccion ---

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
  (m.real_mvp is not null and p.mvp = m.real_mvp) as mvp_hit
from public.predictions p
join public.matches   m on m.id = p.match_id
join public.gameweeks g on g.id = m.gameweek_id
join public.leagues   l on l.id = g.league_id;

-- ------------------------------------------------------ vista: por jornada ---
-- El bonus de pleno exige DOS cosas: que la jornada este entera jugada y que el
-- miembro haya acertado el 1X2 en todos y cada uno de sus partidos. Si le falta
-- un pronostico, el conteo no cuadra y no hay bonus.

create or replace view public.gameweek_points
with (security_invoker = true) as
with per_gameweek as (
  select
    g.id        as gameweek_id,
    g.league_id,
    g.number    as gameweek_number,
    l.scoring,
    count(m.id)                                      as match_count,
    count(m.id) filter (where m.status = 'played')   as played_count
  from public.gameweeks g
  join public.leagues l  on l.id = g.league_id
  left join public.matches m on m.gameweek_id = g.id
  group by g.id, g.league_id, g.number, l.scoring
)
select
  w.gameweek_id,
  w.league_id,
  w.gameweek_number,
  mem.id as member_id,
  coalesce(sum(pp.points), 0)::int as base_points,
  case
    when w.match_count > 0
     and w.played_count = w.match_count
     and count(pp.prediction_id) filter (where pp.sign_hit) = w.match_count
      then coalesce((w.scoring ->> 'pleno')::int, 0)
    else 0
  end as pleno_bonus,
  (
    coalesce(sum(pp.points), 0)
    + case
        when w.match_count > 0
         and w.played_count = w.match_count
         and count(pp.prediction_id) filter (where pp.sign_hit) = w.match_count
          then coalesce((w.scoring ->> 'pleno')::int, 0)
        else 0
      end
  )::int as total_points
from per_gameweek w
join public.members mem on mem.league_id = w.league_id
left join public.prediction_points pp
       on pp.gameweek_id = w.gameweek_id
      and pp.member_id   = mem.id
group by w.gameweek_id, w.league_id, w.gameweek_number, w.match_count,
         w.played_count, w.scoring, mem.id;

-- --------------------------------------------------- vista: clasificacion ---

create or replace view public.standings
with (security_invoker = true) as
select
  mem.league_id,
  mem.id           as member_id,
  mem.display_name,
  mem.avatar_color,
  coalesce(sum(gp.total_points), 0)::int as total_points,
  rank() over (
    partition by mem.league_id
    order by coalesce(sum(gp.total_points), 0) desc
  )::int as position
from public.members mem
left join public.gameweek_points gp on gp.member_id = mem.id
group by mem.league_id, mem.id, mem.display_name, mem.avatar_color;

grant select on public.prediction_points, public.gameweek_points, public.standings
  to authenticated;
