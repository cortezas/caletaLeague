-- El identificador del jugador, para que un cambio de grafia deje de costar puntos.
--
-- EL PROBLEMA, que ya ha mordido tres veces. Los pronosticos guardan el NOMBRE
-- del jugador y los resultados tambien, y las dos puntas de esa comparacion las
-- escribe football-data, que reescribe sus propias plantillas cuando quiere y sin
-- avisar. El 31/08/2026 a las 03:20 refresco las 17 de golpe y acorto media
-- docena de nombres: "Marc Bartra" paso a "Bartra", "Roberto Fernández Jaén" a
-- "Roberto Fernández". Dieciseis aciertos de nueve personas dejaron de contar.
--
-- Y NO ES UN FALLO DE UNA JORNADA. `prediction_points`, `gameweek_points` y
-- `standings` son VISTAS: se recalculan desde los nombres de HOY cada vez que
-- alguien abre la app. Un cambio de grafia no cuesta los puntos de esa semana,
-- reescribe la temporada entera hacia atras.
--
-- POR QUE NO SE CAMBIA LA COMPARACION A IDS. Era la opcion evidente y es la
-- equivocada: obligaria a meter ids en `predictions` y en `matches`, a rellenar
-- 2.072 selecciones ya guardadas, y a tocar la funcion que reparte el dinero.
-- Mucha superficie para el mismo beneficio.
--
-- LO QUE SE HACE. Se guarda el id JUNTO al nombre en la plantilla. Con eso, un
-- cambio de grafia deja de ser invisible: mismo id, nombre distinto. Y cuando la
-- sincronizacion lo detecta, REESCRIBE el nombre viejo por el nuevo en los
-- pronosticos y en los resultados de los partidos de ese equipo, en la misma
-- pasada. El nombre vuelve a cuadrar y la comparacion de puntos no se toca.
--
-- O sea: el id no sustituye al nombre, lo MANTIENE HONESTO.

alter table public.team_squads
  add column if not exists player_ids bigint[];

comment on column public.team_squads.player_ids is
  'Id de football-data de cada jugador, en el MISMO orden que `players`. Sirve para detectar que la API ha renombrado a alguien: mismo id, nombre distinto.';

-- El renombrado, en una funcion y no en TypeScript: son dos UPDATE sobre arrays
-- que tienen que pasar o no pasar juntos, y aqui eso sale gratis.
--
-- Se limita a los partidos donde juega ESE equipo. Sin ese filtro, cambiar un
-- "Bartra" tocaria cualquier otro "Bartra" de la liga, y aunque hoy no haya dos,
-- una regla que depende de que no los haya no es una regla.
create or replace function public.renombrar_jugador(
  p_team_code text,
  p_viejo      text,
  p_nuevo      text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  tocados int := 0;
  n int;
begin
  if public.norm_player(p_viejo) is null or public.norm_player(p_nuevo) is null then
    return 0;
  end if;
  if public.norm_player(p_viejo) = public.norm_player(p_nuevo) then
    return 0;
  end if;

  with partidos as (
    select id from public.matches
    where home_code = p_team_code or away_code = p_team_code
  ),
  cambiados as (
    update public.predictions p
    set scorers = array(select case when public.norm_player(x) = public.norm_player(p_viejo)
                                    then p_nuevo else x end from unnest(p.scorers) x),
        assists = array(select case when public.norm_player(x) = public.norm_player(p_viejo)
                                    then p_nuevo else x end from unnest(p.assists) x),
        mvp     = case when public.norm_player(p.mvp) = public.norm_player(p_viejo)
                       then p_nuevo else p.mvp end
    where p.match_id in (select id from partidos)
      and (public.norm_player(p.mvp) = public.norm_player(p_viejo)
        or exists (select 1 from unnest(p.scorers) x where public.norm_player(x) = public.norm_player(p_viejo))
        or exists (select 1 from unnest(p.assists) x where public.norm_player(x) = public.norm_player(p_viejo)))
    returning 1
  )
  select count(*) into n from cambiados;
  tocados := tocados + n;

  with cambiados as (
    update public.matches m
    set real_scorers = array(select case when public.norm_player(x) = public.norm_player(p_viejo)
                                         then p_nuevo else x end from unnest(m.real_scorers) x),
        real_assists = array(select case when public.norm_player(x) = public.norm_player(p_viejo)
                                         then p_nuevo else x end from unnest(m.real_assists) x),
        real_mvp     = case when public.norm_player(m.real_mvp) = public.norm_player(p_viejo)
                            then p_nuevo else m.real_mvp end
    where (m.home_code = p_team_code or m.away_code = p_team_code)
      and (public.norm_player(m.real_mvp) = public.norm_player(p_viejo)
        or exists (select 1 from unnest(m.real_scorers) x where public.norm_player(x) = public.norm_player(p_viejo))
        or exists (select 1 from unnest(m.real_assists) x where public.norm_player(x) = public.norm_player(p_viejo)))
    returning 1
  )
  select count(*) into n from cambiados;
  tocados := tocados + n;

  return tocados;
end;
$fn$;

revoke all on function public.renombrar_jugador(text, text, text) from public, anon, authenticated;
grant execute on function public.renombrar_jugador(text, text, text) to service_role;

comment on function public.renombrar_jugador(text, text, text) is
  'Cambia una grafia de jugador por otra en pronosticos y resultados, solo en los partidos de ese equipo. La llama la sincronizacion de plantillas cuando football-data renombra a alguien.';
