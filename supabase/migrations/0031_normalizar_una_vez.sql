-- Los nombres se normalizan AL ESCRIBIR, no en cada lectura.
--
-- `standings` costaba 758 ms con 334 pronosticos y escala lineal: a final de
-- temporada seran unos 4900 y eso son ~11 s, por encima del timeout de 8 s del
-- rol `authenticated`. Es el mismo muro contra el que se estrello la app el fin
-- de semana del 15-17/08/2026.
--
-- DONDE SE IBA EL TIEMPO, medido y no supuesto:
--
--   hits_subs, 668 llamadas ............ 541 ms
--   los mismos datos ya normalizados .... 55 ms
--
-- Diez veces. Todo el coste era llamar a `norm_player` una y otra vez sobre los
-- mismos nombres. Y no es que la funcion sea lenta: es que lleva `SET
-- search_path`, y eso impide que Postgres la INCRUSTE. Cada uso es una llamada
-- de verdad, con su cambio de configuracion, decenas de veces por pronostico y
-- en cada carga de la clasificacion.
--
-- La forma normalizada de un nombre no cambia nunca. Calcularla al leer es
-- rehacer siempre la misma cuenta. Ahora se calcula UNA VEZ al escribir, en
-- columnas generadas, y las lecturas solo comparan texto.

-- ---------------------------------------------------------------------------
-- 0. Terreno limpio.
-- ---------------------------------------------------------------------------
-- En una base nueva esto no hace nada. En la de produccion quita las columnas y
-- la funcion que se dejaron al medir el prototipo, porque una columna generada
-- depende de la funcion y no deja recrearla.
alter table public.matches
  drop column if exists real_scorers_n,
  drop column if exists real_assists_n,
  drop column if exists real_mvp_n;
alter table public.predictions
  drop column if exists scorers_n,
  drop column if exists assists_n,
  drop column if exists mvp_n;
alter table public.match_substitutions
  drop column if exists player_out_n,
  drop column if exists player_in_n;
drop function if exists public.norm_array(text[]);

-- ---------------------------------------------------------------------------
-- 1. Normalizar una lista entera.
-- ---------------------------------------------------------------------------
-- En plpgsql y no en SQL a proposito: una columna generada no admite subconsulta,
-- asi que `array_agg(...) from unnest(...)` no vale. Un bucle si.
create or replace function public.norm_array(p_names text[])
returns text[]
language plpgsql
immutable
parallel safe
as $fn$
declare
  salida text[] := '{}';
  x text;
  n text;
begin
  foreach x in array coalesce(p_names, '{}') loop
    n := public.norm_player(x);
    if n is not null then
      salida := salida || n;
    end if;
  end loop;
  return salida;
end;
$fn$;

comment on function public.norm_array(text[]) is
  'norm_player sobre una lista, tirando los vacios. Inmutable para poder usarla en columnas generadas.';

-- ---------------------------------------------------------------------------
-- 2. La forma normalizada, guardada.
-- ---------------------------------------------------------------------------
alter table public.matches
  add column if not exists real_scorers_n text[] generated always as (public.norm_array(real_scorers)) stored,
  add column if not exists real_assists_n text[] generated always as (public.norm_array(real_assists)) stored,
  add column if not exists real_mvp_n     text   generated always as (public.norm_player(real_mvp))    stored;

alter table public.predictions
  add column if not exists scorers_n text[] generated always as (public.norm_array(scorers)) stored,
  add column if not exists assists_n text[] generated always as (public.norm_array(assists)) stored,
  add column if not exists mvp_n     text   generated always as (public.norm_player(mvp))    stored;

alter table public.match_substitutions
  add column if not exists player_out_n text generated always as (public.norm_player(player_out)) stored,
  add column if not exists player_in_n  text generated always as (public.norm_player(player_in))  stored;

create index if not exists match_substitutions_match_out_idx
  on public.match_substitutions (match_id, player_out_n);

-- ---------------------------------------------------------------------------
-- 3. Los aciertos, ya sin normalizar nada.
-- ---------------------------------------------------------------------------
-- Misma logica exacta que la 0030: cada nombre se lleva UNA cosa real como mucho,
-- primero se prueba el nombre tal cual y despues su cadena de relevos, y lo que
-- se lleva uno ya no esta para el siguiente. Lo unico que cambia es que las dos
-- listas llegan normalizadas.
create or replace function public.hits_subs_n(
  p_picks_n  text[],
  p_real_n   text[],
  p_match_id uuid
) returns integer
language plpgsql
stable
as $fn$
declare
  quedan  text[] := coalesce(p_real_n, '{}');
  salen   text[];
  entran  text[];
  cargado boolean := false;
  pick    text;
  actual  text;
  vistos  text[];
  pos     int;
  idx     int;
  salto   int;
  total   int := 0;
begin
  if array_length(quedan, 1) is null then
    return 0;
  end if;

  foreach pick in array coalesce(p_picks_n, '{}') loop
    pos := array_position(quedan, pick);

    if pos is null then
      -- La tabla solo se toca si algun nombre ha fallado de frente, y una sola
      -- vez por llamada.
      if not cargado then
        select coalesce(array_agg(s.player_out_n), '{}'),
               coalesce(array_agg(s.player_in_n), '{}')
          into salen, entran
        from public.match_substitutions s
        where s.match_id = p_match_id
          and s.player_in_n is not null
          and s.player_out_n is not null;
        cargado := true;
      end if;

      actual := pick;
      vistos := array[actual];
      salto := 0;
      -- Tope de saltos y lista de vistos: un dato malo (A sale por B y B sale
      -- por A) no puede colgar esto.
      while pos is null and salto < 4 loop
        idx := array_position(salen, actual);
        exit when idx is null;
        actual := entran[idx];
        exit when actual is null or actual = any (vistos);
        vistos := vistos || actual;
        pos := array_position(quedan, actual);
        salto := salto + 1;
      end loop;
    end if;

    if pos is not null then
      total := total + 1;
      quedan := quedan[1:pos - 1] || quedan[pos + 1:array_length(quedan, 1)];
    end if;
  end loop;

  return total;
end;
$fn$;

comment on function public.hits_subs_n(text[], text[], uuid) is
  'Aciertos con Sustituto + sobre listas YA normalizadas. Espejo exacto de assignHits()/hitVia() en src/lib/data/gameweek.ts.';

-- La version de siempre pasa a ser una envoltura: UNA sola implementacion, dos
-- puertas. Se queda para consultas a mano y para no romper nada que la llame.
create or replace function public.hits_subs(
  p_picks    text[],
  p_real     text[],
  p_match_id uuid
) returns integer
language sql
stable
as $fn$
  select public.hits_subs_n(public.norm_array(p_picks), public.norm_array(p_real), p_match_id);
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Los puntos de un partido, con todo pre-normalizado.
-- ---------------------------------------------------------------------------
-- OJO: el marcador y el MVP se calculan AQUI y no llamando a `calc_points`, que
-- es lo que hacia la 0027. El motivo es que `calc_points` recibe el MVP en crudo
-- y lo volveria a normalizar, que es justo lo que se viene a evitar.
--
-- Son las mismas tres reglas y tienen que seguir siendo las mismas: exacto y 1X2
-- EXCLUYENTES (un exacto suma 3, no 3 + 1) y el MVP comparado en forma
-- normalizada. `public.calc_points` sigue siendo el enunciado canonico de esas
-- reglas y el espejo de scoring.ts; si se tocan ahi, se tocan aqui. Que las dos
-- dan lo mismo se comprueba fila a fila, no de palabra.
create or replace function public.calc_points_n(
  scoring     jsonb,
  p_home      integer, p_away integer, p_mvp_n text, p_scorers_n text[], p_assists_n text[],
  r_home      integer, r_away integer, r_mvp_n text, r_scorers_n text[], r_assists_n text[],
  p_match_id  uuid
) returns integer
language sql
stable
as $fn$
  select case
    when r_home is null or r_away is null then 0
    else
      (case
         when p_home = r_home and p_away = r_away then coalesce((scoring ->> 'exact')::int, 0)
         when sign(p_home - p_away) = sign(r_home - r_away) then coalesce((scoring ->> 'x2')::int, 0)
         else 0
       end)
      + (case
           when p_mvp_n is not null and p_mvp_n = r_mvp_n then coalesce((scoring ->> 'mvp')::int, 0)
           else 0
         end)
      + coalesce((scoring ->> 'scorer')::int, 0) * public.hits_subs_n(p_scorers_n, r_scorers_n, p_match_id)
      + coalesce((scoring ->> 'assist')::int, 0) * public.hits_subs_n(p_assists_n, r_assists_n, p_match_id)
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Las dos rutas de lectura, apuntando a lo rapido.
-- ---------------------------------------------------------------------------
create or replace view public.prediction_points as
  select
    p.id as prediction_id,
    p.member_id,
    p.match_id,
    m.gameweek_id,
    g.league_id,
    g.number as gameweek_number,
    public.calc_points_n(
      l.scoring,
      p.home, p.away, p.mvp_n, p.scorers_n, p.assists_n,
      m.real_home, m.real_away, m.real_mvp_n, m.real_scorers_n, m.real_assists_n,
      p.match_id
    ) as points,
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
  gameweek_id     uuid,
  league_id       uuid,
  gameweek_number integer,
  member_id       uuid,
  base_points     integer,
  pleno_bonus     integer,
  total_points    integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with mis_ligas as (
    select id as league_id from private.user_league_ids() as id
  ),
  puntos as (
    select
      p.member_id,
      m.gameweek_id,
      public.calc_points_n(
        l.scoring,
        p.home, p.away, p.mvp_n, p.scorers_n, p.assists_n,
        m.real_home, m.real_away, m.real_mvp_n, m.real_scorers_n, m.real_assists_n,
        p.match_id
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
$fn$;

drop function if exists public.hits_norm_proto(text[], text[], uuid);
