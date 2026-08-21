-- =============================================================================
-- 0026 - Sustituto + : si cambian a tu jugador, su relevo tambien te cuenta
-- =============================================================================
-- LA REGLA (la del Sustituto + de las casas de apuestas)
-- Pones a Mariano como goleador, lo cambian por Toni Martinez y marca Toni: te
-- cuenta igual. Vale para GOLEADORES y ASISTENTES. El MVP queda FUERA.
-- Encadena: si a Toni tambien lo cambian, sigue con el siguiente.
--
-- COMO SE IMPLEMENTA SIN TOCAR `calc_points`
-- `calc_points` no se toca ni una linea. Sigue siendo el espejo exacto de
-- `scoreMatch` en TypeScript y sigue comparando dos listas. Lo que cambia es lo
-- que se le PASA: la vista `prediction_points` le entrega la lista de pronostico
-- ya EXPANDIDA con los relevos. La regla vive en la vista, no en el calculo.
--
-- Eso importa por dos razones: el espejo TS/SQL no se rompe, y si algun dia hay
-- que quitar la regla, se quita de un sitio.
--
-- POR QUE NO SE PUEDE HACER TRAMPA PONIENDO A LOS DOS
-- Si pones a Mariano Y a Toni, la lista expandida queda [Mariano, Toni, Toni].
-- Los aciertos se cuentan por el MINIMO de las dos listas por jugador
-- (migracion 0022), asi que con un solo gol de Toni el minimo es 1: cuenta una
-- vez, no dos. El agujero se cierra solo, sin ninguna comprobacion extra.
--
-- Y no sale gratis intentarlo: el tope de la 0021 solo deja tantos goleadores
-- como goles tiene tu pronostico, asi que gastar dos huecos en el mismo relevo
-- es perder uno.
--
-- QUE PASA CON LOS PARTIDOS SIN DATOS DE CAMBIOS
-- Nada. Sin filas en `match_substitutions` la expansion devuelve la lista tal
-- cual, asi que las jornadas ya jugadas puntuan exactamente igual que antes.
-- =============================================================================

-- ------------------------------------------------------- expansion ---

/**
 * La lista de nombres mas los relevos de cada uno, encadenando.
 *
 * Compara por `norm_player`, asi que "Lee Kang In" y "Lee Kang-In" son el mismo
 * (migracion 0024). Devuelve los nombres tal como los escribio la persona mas
 * los de los relevos tal como los manda la API: da igual, porque quien compara
 * vuelve a normalizar.
 *
 * `cycle` en el recursivo no es paranoia: si la API mandara un cambio A->B y otro
 * B->A en el mismo partido (un dato malo), sin el la consulta no terminaria.
 */
create or replace function public.expand_with_subs(p_names text[], p_match_id uuid)
returns text[]
language sql
stable
as $$
  with recursive base as (
    select nombre, 0 as salto
    from unnest(coalesce(p_names, '{}')) as nombre
  ),
  cadena as (
    select nombre, salto, array[public.norm_player(nombre)] as vistos
    from base
    union all
    select s.player_in, c.salto + 1, c.vistos || public.norm_player(s.player_in)
    from cadena c
    join public.match_substitutions s
      on s.match_id = p_match_id
     and public.norm_player(s.player_out) = public.norm_player(c.nombre)
    where s.player_in is not null
      -- Tope de saltos: en un partido real no hay tres relevos del mismo hueco,
      -- y con esto la recursion tiene final aunque el dato venga raro.
      and c.salto < 4
      and not (public.norm_player(s.player_in) = any (c.vistos))
  )
  select coalesce(array_agg(nombre), '{}')
  from cadena
  where nombre is not null;
$$;

comment on function public.expand_with_subs is
  'Los nombres dados mas los relevos de cada uno, encadenando (Sustituto +). '
  'Se usa desde la vista prediction_points para expandir el pronostico ANTES de '
  'compararlo; calc_points no se entera. Ver la migracion 0026.';

-- ------------------------------------------------------------ vista ---
-- Misma vista de siempre, con dos cambios: los goleadores y los asistentes del
-- PRONOSTICO se expanden con los relevos. El MVP no, por decision de la peña.

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
    p.home, p.away, p.mvp,
    public.expand_with_subs(p.scorers, p.match_id),
    public.expand_with_subs(p.assists, p.match_id),
    m.real_home, m.real_away, m.real_mvp, m.real_scorers, m.real_assists
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
