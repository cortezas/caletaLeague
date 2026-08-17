-- =============================================================================
-- 0023 - Lo que lleva pagado cada uno (`season_dues`)
-- =============================================================================
-- LA REGLA DE LA PEÑA
-- Los tres ultimos de cada jornada pagan: el ultimo 3 euros, el penultimo 2 y el
-- antepenultimo 1. Esto suma lo de todas las jornadas ACABADAS.
--
-- POR QUE EN SQL Y NO SUMANDO EN LA APLICACION
-- Haria falta traerse todos los pronosticos de la temporada, y PostgREST corta a
-- 1000 filas por defecto. Con 15 personas y 380 partidos son ~5.700: el
-- acumulado saldria corto Y EN SILENCIO, que con dinero en medio es lo peor que
-- puede pasar. Aqui se agrega en la base y viajan 15 filas.
--
-- EL DESEMPATE, DE PEOR A MEJOR
--   1. menos puntos;
--   2. menos partidos pronosticados -- no jugar es peor que jugar y fallar;
--   3. menos aciertos de 1X2;
--   4. y si aun asi hay empate, el id de miembro.
--
-- El cuarto no es justo, es DETERMINISTA: sin el, dos personas identicas podrian
-- intercambiarse el puesto entre dos consultas y la pantalla diria una cosa
-- distinta cada vez.
--
-- ESPEJO EXACTO de `duesForGameweek` en src/lib/dues.ts, que es la que usa la
-- pantalla de una jornada suelta. Si se toca una, se toca la otra.
--
-- SOLO JORNADAS ACABADAS: una jornada a medias no cuenta. El orden de abajo se
-- mueve con cada partido que entra, y cobrar por una foto provisional no tiene
-- ningun sentido.
--
-- `security definer` por lo mismo que `gameweek_points_calc` (0019): evita pagar
-- la RLS fila a fila, y el filtro de liga va explicito con
-- `private.user_league_ids()`. No expone nada nuevo -- quien paga cada jornada lo
-- ve toda la peña por definicion.
-- =============================================================================

create or replace function public.season_dues()
returns table (member_id uuid, euros int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mis_ligas as (
    select id as league_id from private.user_league_ids() as id
  ),
  -- Jornadas con TODOS sus partidos jugados.
  completas as (
    select g.id as gameweek_id
    from public.gameweeks g
    join public.matches m on m.gameweek_id = g.id
    where g.league_id in (select league_id from mis_ligas)
    group by g.id
    having count(m.id) = count(m.id) filter (where m.status = 'played')
  ),
  -- Cuantos pronostico cada uno y cuantos 1X2 acerto, por jornada. Sale de
  -- `prediction_points` para que la definicion de "acierto de 1X2" viva en un
  -- solo sitio y no se pueda desincronizar.
  detalle as (
    select m.gameweek_id, pp.member_id,
           count(*) as predicciones,
           count(*) filter (where pp.sign_hit) as aciertos
    from public.prediction_points pp
    join public.matches m on m.id = pp.match_id
    where m.gameweek_id in (select gameweek_id from completas)
    group by m.gameweek_id, pp.member_id
  ),
  puntos as (
    select gp.gameweek_id, gp.member_id, gp.total_points
    from public.gameweek_points_calc() gp
    where gp.gameweek_id in (select gameweek_id from completas)
  ),
  -- 1 = ultimo, 2 = penultimo, 3 = antepenultimo.
  desde_abajo as (
    select
      pu.member_id,
      row_number() over (
        partition by pu.gameweek_id
        order by pu.total_points asc,
                 coalesce(d.predicciones, 0) asc,
                 coalesce(d.aciertos, 0) asc,
                 pu.member_id asc
      ) as puesto
    from puntos pu
    left join detalle d
           on d.gameweek_id = pu.gameweek_id
          and d.member_id   = pu.member_id
  )
  select
    member_id,
    sum(case puesto when 1 then 3 when 2 then 2 when 3 then 1 else 0 end)::int as euros
  from desde_abajo
  where puesto <= 3
  group by member_id;
$$;

comment on function public.season_dues is
  'Euros acumulados por miembro: 3 el ultimo de cada jornada acabada, 2 el '
  'penultimo, 1 el antepenultimo. Espejo de duesForGameweek en src/lib/dues.ts. '
  'Se agrega en SQL para no chocar con el limite de 1000 filas de PostgREST. '
  'Ver la migracion 0023.';

grant execute on function public.season_dues() to authenticated, service_role;
