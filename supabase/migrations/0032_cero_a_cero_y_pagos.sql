-- Dos cosas: premiar el 0-0 y llevar la cuenta de lo que la gente va pagando.

-- ---------------------------------------------------------------------------
-- 1. Bonus por acertar un 0-0.
-- ---------------------------------------------------------------------------
-- Un 0-0 acertado paga 3 puntos y se acaba ahi: no hay goleador ni asistente que
-- acertar, asi que quien lo pone renuncia de entrada a los 2 + 1 por gol que se
-- llevan los demas. Con ese descuento nadie pone nunca un 0-0, y un pronostico
-- que nadie hace deja de ser un pronostico.
--
-- Se suma A MAYORES del exacto: acertar un 0-0 son los 3 del marcador clavado
-- mas estos 3, o sea 6. No sustituye a nada.
--
-- Va en `leagues.scoring` como todo lo demas, para poder tocarlo desde el panel
-- sin migracion.
update public.leagues
set scoring = scoring || jsonb_build_object('goalless', 3)
where not (scoring ? 'goalless');

-- `calc_points` es el enunciado canonico de las reglas y el espejo de
-- src/lib/scoring.ts. Se toca aqui Y ALLI, siempre las dos.
create or replace function public.calc_points(
  scoring jsonb,
  p_home integer, p_away integer, p_mvp text, p_scorers text[], p_assists text[],
  r_home integer, r_away integer, r_mvp text, r_scorers text[], r_assists text[]
) returns integer
language sql
immutable
parallel safe
as $fn$
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
      -- Premio del 0-0, ADEMAS del exacto: quien lo acierta no puede sumar por
      -- goleadores ni asistentes, porque no los hay.
      + (case
           when p_home = 0 and p_away = 0 and r_home = 0 and r_away = 0
             then coalesce((scoring ->> 'goalless')::int, 0)
           else 0
         end)
      -- MVP, comparado en forma normalizada.
      + (case
           when public.norm_player(p_mvp) is not null
            and public.norm_player(p_mvp) = public.norm_player(r_mvp)
             then coalesce((scoring ->> 'mvp')::int, 0)
           else 0
         end)
      -- Goleadores, CONTANDO LAS VECES. `least` por jugador es lo que hace que
      -- un doblete acertado valga dos y que pasarse no sume de mas.
      + coalesce((scoring ->> 'scorer')::int, 0) * (
          select coalesce(sum(least(pc.veces, rc.veces)), 0)::int
          from (
            select public.norm_player(s) as nombre, count(*) as veces
            from unnest(coalesce(p_scorers, '{}')) s
            where public.norm_player(s) is not null group by 1
          ) pc
          join (
            select public.norm_player(s) as nombre, count(*) as veces
            from unnest(coalesce(r_scorers, '{}')) s
            where public.norm_player(s) is not null group by 1
          ) rc on rc.nombre = pc.nombre
        )
      -- Asistentes. Mismo criterio, y APARTE de los goles: el mismo jugador
      -- puede aparecer en las dos listas y ahi hay dos aciertos, no uno.
      + coalesce((scoring ->> 'assist')::int, 0) * (
          select coalesce(sum(least(pa.veces, ra.veces)), 0)::int
          from (
            select public.norm_player(a) as nombre, count(*) as veces
            from unnest(coalesce(p_assists, '{}')) a
            where public.norm_player(a) is not null group by 1
          ) pa
          join (
            select public.norm_player(a) as nombre, count(*) as veces
            from unnest(coalesce(r_assists, '{}')) a
            where public.norm_player(a) is not null group by 1
          ) ra on ra.nombre = pa.nombre
        )
  end
$fn$;

-- Y la version rapida, que es la que usan de verdad las dos rutas de lectura.
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
           when p_home = 0 and p_away = 0 and r_home = 0 and r_away = 0
             then coalesce((scoring ->> 'goalless')::int, 0)
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
-- 2. Los pagos de la deuda.
-- ---------------------------------------------------------------------------
-- `season_dues()` dice lo que DEBE cada uno. Lo que ha PAGADO no estaba en
-- ningun sitio, asi que el organizador lo llevaba de cabeza.
--
-- Se guarda pago a pago y no como un saldo: un saldo no se puede auditar ni
-- deshacer, y aqui una cifra mal metida es dinero de verdad entre companeros.
-- Con el historial, un error se borra y ya esta.
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  -- En euros enteros: la peña paga de 1 en 1. Positivo siempre; para corregir un
  -- error se borra la fila, no se mete un negativo.
  euros      integer not null check (euros > 0 and euros <= 500),
  nota       text check (nota is null or length(nota) <= 120),
  paid_at    timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payments_member_idx on public.payments (member_id);
create index if not exists payments_league_idx on public.payments (league_id);

alter table public.payments enable row level security;

-- LOS VE TODA LA PEÑA, a proposito. El bote es de todos y quien ha pagado y
-- quien no es justo la informacion que evita el "yo ya te lo di". Lo mismo que
-- ya pasa con los puntos y con quien paga cada jornada.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select
  using (league_id in (select id from private.user_league_ids() as id));

-- Pero SOLO EL ORGANIZADOR los mete y los quita. El dinero lo cobra el.
drop policy if exists payments_admin_write on public.payments;
create policy payments_admin_write on public.payments
  for all
  using (exists (select 1 from public.leagues l
                 where l.id = payments.league_id and l.admin_user_id = auth.uid()))
  with check (exists (select 1 from public.leagues l
                      where l.id = payments.league_id and l.admin_user_id = auth.uid()));

comment on table public.payments is
  'Pagos de la deuda del bote, uno por fila. Los ve toda la peña; solo el organizador los mete y los borra.';

-- ---------------------------------------------------------------------------
-- 3. El saldo: lo que debe, lo que ha pagado y lo que le queda.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER con el search_path fijado, igual que `season_dues` y por lo
-- mismo: asi no se paga la RLS fila a fila. Devuelve una fila por miembro de la
-- peña, incluidos los que no deben nada, para que la pantalla no tenga que
-- rellenar huecos.
create or replace function public.season_balance()
returns table (
  member_id uuid,
  debido    integer,
  pagado    integer,
  pendiente integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with mis_ligas as (
    select id as league_id from private.user_league_ids() as id
  ),
  deuda as (
    select sd.member_id, sd.euros from public.season_dues() sd
  ),
  cobrado as (
    select p.member_id, sum(p.euros)::int as euros
    from public.payments p
    where p.league_id in (select league_id from mis_ligas)
    group by p.member_id
  )
  select
    mem.id,
    coalesce(d.euros, 0)::int,
    coalesce(c.euros, 0)::int,
    -- Nunca negativo: si alguien paga de mas, le queda a cero y el de mas se ve
    -- en la columna de pagado. Un "te debo -2 euros" en pantalla no lo entiende
    -- nadie.
    greatest(coalesce(d.euros, 0) - coalesce(c.euros, 0), 0)::int
  from public.members mem
  left join deuda   d on d.member_id = mem.id
  left join cobrado c on c.member_id = mem.id
  where mem.league_id in (select league_id from mis_ligas);
$fn$;

comment on function public.season_balance() is
  'Por miembro: lo que debe del bote, lo que lleva pagado y lo que le queda. Pendiente nunca negativo.';
