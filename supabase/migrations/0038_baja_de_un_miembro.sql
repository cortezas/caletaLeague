-- 0038. Dar de baja a alguien a partir de una jornada, sin borrarle el pasado.
--
-- Litronillos deja la peña en la jornada 7. Las dos salidas obvias eran malas:
-- borrarlo se lleva por delante sus seis jornadas jugadas y los 11 euros que
-- debe, y dejarlo tal cual lo hace ULTIMO de todas las jornadas que quedan y le
-- sigue cobrando 3 euros por no jugar -- ademas de sacar de los puestos de pago
-- a quien si jugo y quedo el ultimo de verdad.
--
-- `baja_desde_jornada` es la PRIMERA jornada que ya no juega. Null = sigue.
--
-- El filtro va en UN SOLO SITIO, `gameweek_points_calc`, porque es de donde
-- cuelga todo lo demas: la clasificacion de la jornada, la general (que suma sus
-- filas) y `season_dues` (que ordena por abajo las filas que existan). Sin fila
-- en la jornada 7 no aparece, no puntua y no paga; con las de la 1 a la 6
-- intactas conserva sus puntos y su deuda, que es justo lo que se pidio.
alter table public.members
  add column if not exists baja_desde_jornada smallint
  check (baja_desde_jornada is null or baja_desde_jornada >= 1);

comment on column public.members.baja_desde_jornada is
  'Primera jornada en la que este miembro ya no juega. Null = activo. No borra '
  'nada del pasado: deja de generar fila en gameweek_points_calc desde esa '
  'jornada, asi que no puntua ni entra en el reparto de euros, pero conserva '
  'los puntos y la deuda de las jornadas anteriores.';

create or replace function public.gameweek_points_calc()
returns table(gameweek_id uuid, league_id uuid, gameweek_number integer, member_id uuid, base_points integer, pleno_bonus integer, total_points integer)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
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
  join public.members mem
    on mem.league_id = w.league_id
   -- La baja: desde esa jornada, este miembro ya no genera fila.
   and (mem.baja_desde_jornada is null or w.gameweek_number < mem.baja_desde_jornada)
  left join puntos pt on pt.gameweek_id = w.gameweek_id and pt.member_id = mem.id
  group by w.gameweek_id, w.league_id, w.gameweek_number, w.match_count,
           w.played_count, w.scoring, mem.id;
$fn$;
