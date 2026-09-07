-- 0037. `renombrar_jugador` tambien reescribe los CAMBIOS del partido.
--
-- La version de la 0036 tocaba `predictions` y `matches` y se dejaba
-- `match_substitutions`, que es donde vive el Sustituto +. Eso convertia el
-- arreglo de un nombre en una forma nueva de romper puntos:
--
--   cambio guardado   Fermin Lopez -> "Daniel Olmo Carvajal"   (75', VAL-BAR)
--   real_assists      "Daniel Olmo Carvajal" x2
--
-- `hits_subs_n` encadena comparando el `player_in_n` del cambio con lo que hay
-- en `real_assists_n`. Renombrar solo en `matches` deja el cambio apuntando a un
-- nombre que ya no existe en ningun sitio, y la cadena se corta en silencio:
-- quien puso a Fermin deja de cobrar lo que hizo Olmo.
--
-- Asi que el renombrado tiene que ser ATOMICO en las tres tablas. Las columnas
-- `player_out_n` / `player_in_n` son generadas STORED, se recalculan solas.
create or replace function public.renombrar_jugador(p_team_code text, p_viejo text, p_nuevo text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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

  -- Los cambios del partido, la pata que faltaba.
  with partidos as (
    select id from public.matches
    where home_code = p_team_code or away_code = p_team_code
  ),
  cambiados as (
    update public.match_substitutions s
    set player_out = case when public.norm_player(s.player_out) = public.norm_player(p_viejo)
                          then p_nuevo else s.player_out end,
        player_in  = case when public.norm_player(s.player_in) = public.norm_player(p_viejo)
                          then p_nuevo else s.player_in end
    where s.match_id in (select id from partidos)
      and (public.norm_player(s.player_out) = public.norm_player(p_viejo)
        or public.norm_player(s.player_in) = public.norm_player(p_viejo))
    returning 1
  )
  select count(*) into n from cambiados;
  tocados := tocados + n;

  return tocados;
end;
$$;

revoke all on function public.renombrar_jugador(text, text, text) from public, anon, authenticated;
grant execute on function public.renombrar_jugador(text, text, text) to service_role;
