-- Los records de la peña: la materia prima del pique.
--
-- En el perfil ya hay una racha, pero es TUYA y solo la ves tu. Lo que genera
-- conversacion en el grupo es lo colectivo: quien clava mas marcadores, quien
-- lleva mas jornadas sin acertar un goleador, quien va pagando siempre.
--
-- Todo sale de datos que ya estan. No hace falta guardar nada nuevo: se calcula
-- al leer, en una sola pasada por consulta, y por eso es una funcion y no una
-- tabla que haya que mantener al dia.
--
-- SECURITY DEFINER con el search_path fijado, igual que `season_dues` y
-- `gameweek_points_calc` y por lo mismo: asi no se paga la RLS fila a fila.
--
-- SOLO JORNADAS ACABADAS, como el bote. Un record a media jornada cambia cada
-- pocas horas y deja de ser un record.

create or replace function public.records_de_la_pena()
returns table (
  clave     text,
  titulo    text,
  detalle   text,
  member_id uuid,
  valor     integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with mis_ligas as (
    select id as league_id from private.user_league_ids() as id
  ),
  completas as (
    select g.id as gameweek_id, g.number
    from public.gameweeks g
    join public.matches m on m.gameweek_id = g.id
    where g.league_id in (select league_id from mis_ligas)
    group by g.id, g.number
    having count(m.id) = count(m.id) filter (where m.status = 'played')
  ),
  jornadas as (
    select gp.member_id, gp.gameweek_id, c.number, gp.total_points
    from public.gameweek_points_calc() gp
    join completas c on c.gameweek_id = gp.gameweek_id
  ),
  -- Aciertos sueltos de toda la temporada, jornada acabada o no: aqui lo que se
  -- cuenta es la punteria, y un acierto de ayer cuenta igual.
  detalle_pred as (
    select
      p.member_id,
      pp.exact_hit,
      pp.mvp_hit,
      p.home + p.away as goles_dichos,
      public.hits_subs_n(p.scorers_n, m.real_scorers_n, p.match_id) as goleadores,
      public.hits_subs_n(p.assists_n, m.real_assists_n, p.match_id) as asistentes
    from public.predictions p
    join public.matches m on m.id = p.match_id
    join public.gameweeks g on g.id = m.gameweek_id
    join public.prediction_points pp on pp.prediction_id = p.id
    where g.league_id in (select league_id from mis_ligas)
      and m.status = 'played'
  ),
  -- La media de la peña por jornada, para la racha.
  medias as (
    select gameweek_id, avg(total_points) as media from jornadas group by gameweek_id
  ),
  -- Numeradas de la ultima hacia atras, por persona.
  desde_el_final as (
    select j.member_id, j.number, j.total_points > md.media as por_encima,
           row_number() over (partition by j.member_id order by j.number desc) as atras
    from jornadas j join medias md on md.gameweek_id = j.gameweek_id
  ),
  -- La racha viva es cuantas seguidas van por encima antes del primer fallo.
  racha as (
    select member_id,
           coalesce(min(atras) filter (where not por_encima), max(atras) + 1) - 1 as seguidas
    from desde_el_final group by member_id
  ),
  -- Lo mismo pero al reves: jornadas seguidas SIN acertar ni un goleador.
  sequia as (
    select d.member_id,
           coalesce(min(d.atras) filter (where d.goleadores > 0), max(d.atras) + 1) - 1 as seguidas
    from (
      select p.member_id,
             public.hits_subs_n(p.scorers_n, m.real_scorers_n, p.match_id) as goleadores,
             row_number() over (partition by p.member_id order by m.kickoff_at desc) as atras
      from public.predictions p
      join public.matches m on m.id = p.match_id
      join public.gameweeks g on g.id = m.gameweek_id
      where g.league_id in (select league_id from mis_ligas) and m.status = 'played'
    ) d
    group by d.member_id
  ),
  -- Un record por clave: se ordena y se coge el primero. El desempate por
  -- member_id no es justo, es DETERMINISTA, que es lo que importa para que la
  -- pantalla no diga una cosa distinta en cada carga.
  crudos as (
    select 'mejor_jornada' as clave, 'Mejor jornada' as titulo,
           'Jornada ' || number as detalle, member_id, total_points as valor,
           row_number() over (order by total_points desc, number asc, member_id) as n
    from jornadas
    union all
    select 'peor_jornada', 'Peor jornada', 'Jornada ' || number, member_id, total_points,
           row_number() over (order by total_points asc, number asc, member_id)
    from jornadas
    union all
    select 'exactos', 'Más marcadores clavados', 'en toda la temporada', member_id,
           count(*) filter (where exact_hit)::int,
           row_number() over (order by count(*) filter (where exact_hit) desc, member_id)
    from detalle_pred group by member_id
    union all
    select 'goleadores', 'Mejor ojo para el gol', 'goleadores acertados', member_id,
           coalesce(sum(goleadores), 0)::int,
           row_number() over (order by coalesce(sum(goleadores), 0) desc, member_id)
    from detalle_pred group by member_id
    union all
    select 'asistentes', 'El de los pases', 'asistencias acertadas', member_id,
           coalesce(sum(asistentes), 0)::int,
           row_number() over (order by coalesce(sum(asistentes), 0) desc, member_id)
    from detalle_pred group by member_id
    union all
    select 'mvps', 'Más MVP acertados', 'en toda la temporada', member_id,
           count(*) filter (where mvp_hit)::int,
           row_number() over (order by count(*) filter (where mvp_hit) desc, member_id)
    from detalle_pred group by member_id
    union all
    select 'goleador_loco', 'El más optimista', 'goles de media por partido', member_id,
           round(avg(goles_dichos))::int,
           row_number() over (order by avg(goles_dichos) desc, member_id)
    from detalle_pred group by member_id
    union all
    select 'paganini', 'El que más suelta', 'euros de bote acumulados', sd.member_id, sd.euros,
           row_number() over (order by sd.euros desc, sd.member_id)
    from public.season_dues() sd
    union all
    select 'racha', 'Racha viva', 'jornadas seguidas por encima de la media', member_id, seguidas::int,
           row_number() over (order by seguidas desc, member_id)
    from racha
    union all
    select 'sequia', 'Sin oler el gol', 'partidos seguidos sin acertar un goleador', member_id, seguidas::int,
           row_number() over (order by seguidas desc, member_id)
    from sequia
  )
  -- Un record con valor 0 no es un record, es un hueco: fuera.
  select clave, titulo, detalle, member_id, valor
  from crudos
  where n = 1 and valor > 0;
$fn$;

comment on function public.records_de_la_pena() is
  'Los records de la peña, uno por clave. Solo jornadas acabadas para lo que va por jornadas. Se calcula al leer: no hay nada que mantener al dia.';
