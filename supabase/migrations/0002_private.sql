-- =============================================================================
-- 0002 - Esquema `private`: helpers SECURITY DEFINER para las politicas RLS
-- =============================================================================
-- Por que existe esto: una politica sobre `members` que consulte `members`
-- provoca "infinite recursion detected in policy for relation members". La
-- salida estandar es sacar la consulta a una funcion SECURITY DEFINER, que
-- salta RLS al ejecutarse.
--
-- Van en un esquema `private` aparte para que NO queden expuestas en la API
-- REST de Supabase (que solo publica `public`).
--
-- Todas son `stable` y con `search_path` fijado: sin eso, un usuario podria
-- crear un esquema en su search_path y secuestrar la resolucion de nombres
-- dentro de una funcion SECURITY DEFINER.
-- =============================================================================

create schema if not exists private;

-- Ligas a las que pertenece el usuario actual.
create or replace function private.user_league_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select league_id from public.members where user_id = (select auth.uid())
$$;

-- Fichas de miembro del usuario actual (una por liga).
create or replace function private.user_member_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.members where user_id = (select auth.uid())
$$;

-- Ligas que el usuario actual administra.
create or replace function private.admin_league_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.leagues where admin_user_id = (select auth.uid())
$$;

create or replace function private.gameweek_league_id(p_gameweek_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select league_id from public.gameweeks where id = p_gameweek_id
$$;

create or replace function private.match_league_id(p_match_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.league_id
  from public.matches m
  join public.gameweeks g on g.id = m.gameweek_id
  where m.id = p_match_id
$$;

-- El pitido inicial. Es la unica fuente de verdad del sellado: `status` es
-- informativo para la UI, esta funcion es la que manda en las politicas.
create or replace function private.match_kickoff_at(p_match_id uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select kickoff_at from public.matches where id = p_match_id
$$;

create or replace function private.member_league_id(p_member_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select league_id from public.members where id = p_member_id
$$;

-- Sin estos grants las politicas fallan: se evaluan con los privilegios del
-- usuario que consulta, no con los del propietario de la funcion.
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
