-- =============================================================================
-- 0011 - Asistencias
-- =============================================================================
-- Se anade una tercera categoria de jugador al pronostico: quien da el pase de
-- gol. Va en lista APARTE de los goleadores, no como pareja de cada gol: el
-- mismo jugador puede marcar y asistir en el mismo partido, y son dos aciertos
-- legitimos.
--
-- Puntuacion por defecto: 1 punto por asistente acertado, la mitad que un gol.
-- Es mas facil repartir asistencias que goles y no debe pesar igual. Como todo
-- lo demas, el organizador lo cambia desde el panel.
--
-- POR QUE ESTA MIGRACION ES LARGA
-- `calc_points` cambia de FIRMA (dos parametros nuevos), y `create or replace`
-- no puede cambiar la firma de una funcion. Hay que dropearla, y las tres vistas
-- cuelgan de ella, asi que se tiran y se recrean en el orden correcto:
--   standings -> gameweek_points -> prediction_points  (al tirar)
--   prediction_points -> gameweek_points -> standings  (al crear)
--
-- La API de football-data.org no da ni goleadores ni asistentes en el plan
-- gratuito, asi que los reales los mete el organizador tras el partido.
-- =============================================================================

-- ------------------------------------------------------------- columnas ---

alter table public.predictions
  add column if not exists assists text[] not null default '{}';

alter table public.matches
  add column if not exists real_assists text[] not null default '{}';

comment on column public.predictions.assists is
  'Jugadores que se pronostica que daran una asistencia. Lista independiente de scorers.';
comment on column public.matches.real_assists is
  'Asistentes reales. Los mete el organizador: la API gratuita no los da.';

-- "Sin goles" tampoco admite asistentes: sin goles no hay pases de gol.
alter table public.predictions
  drop constraint if exists predictions_no_goals_excludes_scorers;

alter table public.predictions
  add constraint predictions_no_goals_excludes_scorers check (
    not (no_goals and (cardinality(scorers) > 0 or cardinality(assists) > 0))
  );

-- ------------------------------------------------ puntuacion de las ligas ---
-- Backfill ANTES de tocar la restriccion: si se aprieta primero, las filas que
-- ya existen la incumplen y el alter falla.

update public.leagues
set scoring = scoring || jsonb_build_object('assist', 1)
where not (scoring ? 'assist');

alter table public.leagues drop constraint if exists leagues_scoring_shape;

alter table public.leagues
  add constraint leagues_scoring_shape check (
    scoring ? 'exact' and scoring ? 'x2' and scoring ? 'mvp'
    and scoring ? 'scorer' and scoring ? 'assist' and scoring ? 'pleno'
  );

alter table public.leagues
  alter column scoring
  set default '{"exact":3,"x2":1,"mvp":2,"scorer":2,"assist":1,"pleno":5}'::jsonb;

-- ------------------------------------------------------ fuera las vistas ---
-- De la que mas depende a la que menos.

drop view if exists public.standings;
drop view if exists public.gameweek_points;
drop view if exists public.prediction_points;

drop function if exists public.calc_points(jsonb, int, int, text, text[], int, int, text, text[]);

-- ------------------------------------------------------------ calc_points ---
-- Espejo de scoreMatch() en src/lib/scoring.ts. Si se toca una, se toca la otra.

create or replace function public.calc_points(
  scoring  jsonb,
  p_home   int, p_away int, p_mvp text, p_scorers text[], p_assists text[],
  r_home   int, r_away int, r_mvp text, r_scorers text[], r_assists text[]
) returns int
language sql immutable parallel safe as $$
  select case
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
      -- Goleadores. INTERSECT sobre nombres normalizados: deduplica y tolera acentos.
      + coalesce((scoring ->> 'scorer')::int, 0) * (
          select count(*)::int from (
            select public.norm_player(s) from unnest(coalesce(p_scorers,'{}')) s
            where public.norm_player(s) is not null
            intersect
            select public.norm_player(s) from unnest(coalesce(r_scorers,'{}')) s
            where public.norm_player(s) is not null
          ) hit
        )
      -- Asistentes. Se cuentan APARTE de los goles: el mismo jugador puede
      -- aparecer en las dos listas y ahi hay dos aciertos, no uno.
      + coalesce((scoring ->> 'assist')::int, 0) * (
          select count(*)::int from (
            select public.norm_player(a) from unnest(coalesce(p_assists,'{}')) a
            where public.norm_player(a) is not null
            intersect
            select public.norm_player(a) from unnest(coalesce(r_assists,'{}')) a
            where public.norm_player(a) is not null
          ) hit
        )
  end
$$;

comment on function public.calc_points is
  'Espejo SQL de scoreMatch() en src/lib/scoring.ts. Exact y x2 excluyentes; '
  'goleadores y asistentes se cuentan por separado; nombres via norm_player.';

-- ------------------------------------------------------ vistas, de vuelta ---

create view public.prediction_points
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
    p.home, p.away, p.mvp, p.scorers, p.assists,
    m.real_home, m.real_away, m.real_mvp, m.real_scorers, m.real_assists
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

create view public.gameweek_points
with (security_invoker = true) as
with per_gameweek as (
  select
    g.id        as gameweek_id,
    g.league_id,
    g.number    as gameweek_number,
    l.scoring,
    count(m.id)                                    as match_count,
    count(m.id) filter (where m.status = 'played') as played_count
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

create view public.standings
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
