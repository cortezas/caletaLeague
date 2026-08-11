-- =============================================================================
-- 0003 - Row Level Security
-- =============================================================================
-- Esta migracion ES el producto. La regla "nadie ve tu pronostico hasta el
-- pitido inicial" no es una decision de interfaz: el estado "sellado" que
-- pinta la UI es un REFLEJO de estas politicas, no su implementacion.
--
-- Dos patrones de rendimiento aplicados en todas ellas:
--   1. `(select auth.uid())` en vez de `auth.uid()` a pelo. Envuelto en
--      subconsulta el planificador lo evalua UNA vez (initPlan) en lugar de
--      una vez por fila.
--   2. `columna = any (array(select private.f()))` en vez de
--      `columna in (select private.f())`. Con SECURITY DEFINER la segunda
--      forma se reevalua por fila y degrada de milisegundos a minutos.
-- =============================================================================

alter table public.leagues     enable row level security;
alter table public.members     enable row level security;
alter table public.gameweeks   enable row level security;
alter table public.matches     enable row level security;
alter table public.predictions enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------- leagues ---

drop policy if exists leagues_select on public.leagues;
create policy leagues_select on public.leagues for select to authenticated
using ( id = any (array(select private.user_league_ids())) );

drop policy if exists leagues_insert on public.leagues;
create policy leagues_insert on public.leagues for insert to authenticated
with check ( admin_user_id = (select auth.uid()) );

drop policy if exists leagues_update_admin on public.leagues;
create policy leagues_update_admin on public.leagues for update to authenticated
using      ( admin_user_id = (select auth.uid()) )
with check ( admin_user_id = (select auth.uid()) );

drop policy if exists leagues_delete_admin on public.leagues;
create policy leagues_delete_admin on public.leagues for delete to authenticated
using ( admin_user_id = (select auth.uid()) );

-- ---------------------------------------------------------------- members ---
-- Sin politica de INSERT a proposito: el alta pasa SIEMPRE por la RPC
-- public.join_league(), porque `leagues` no es legible para quien aun no es
-- miembro y por tanto nadie puede resolver un codigo de invitacion por su cuenta.

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using ( league_id = any (array(select private.user_league_ids())) );

drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members for update to authenticated
using      ( user_id = (select auth.uid()) )
with check ( user_id = (select auth.uid()) );

drop policy if exists members_delete_self_or_admin on public.members;
create policy members_delete_self_or_admin on public.members for delete to authenticated
using (
  user_id = (select auth.uid())
  or league_id = any (array(select private.admin_league_ids()))
);

-- -------------------------------------------------------------- gameweeks ---

drop policy if exists gameweeks_select on public.gameweeks;
create policy gameweeks_select on public.gameweeks for select to authenticated
using ( league_id = any (array(select private.user_league_ids())) );

drop policy if exists gameweeks_write_admin on public.gameweeks;
create policy gameweeks_write_admin on public.gameweeks for all to authenticated
using      ( league_id = any (array(select private.admin_league_ids())) )
with check ( league_id = any (array(select private.admin_league_ids())) );

-- ---------------------------------------------------------------- matches ---

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select to authenticated
using ( private.gameweek_league_id(gameweek_id) = any (array(select private.user_league_ids())) );

drop policy if exists matches_write_admin on public.matches;
create policy matches_write_admin on public.matches for all to authenticated
using      ( private.gameweek_league_id(gameweek_id) = any (array(select private.admin_league_ids())) )
with check ( private.gameweek_league_id(gameweek_id) = any (array(select private.admin_league_ids())) );

-- ------------------------------------------------------------ predictions ---
-- LO CRITICO. Cuatro politicas, tres reglas:
--   a) mi pronostico lo leo siempre
--   b) el de los demas solo cuando su partido ya ha empezado, y solo en mi liga
--   c) escribir solo el mio, y solo antes del pitido inicial

drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions for select to authenticated
using (
  member_id = any (array(select private.user_member_ids()))
  or (
    private.match_league_id(match_id) = any (array(select private.user_league_ids()))
    and private.match_kickoff_at(match_id) <= now()
  )
);

drop policy if exists predictions_insert_own on public.predictions;
create policy predictions_insert_own on public.predictions for insert to authenticated
with check (
  member_id = any (array(select private.user_member_ids()))
  and private.match_kickoff_at(match_id) > now()
  -- Coherencia de liga: la ficha y el partido tienen que ser de la misma peña.
  and private.match_league_id(match_id) = private.member_league_id(member_id)
);

-- El kickoff va tambien en el USING: pasada la hora la fila deja de ser
-- visible para el UPDATE y el resultado es "UPDATE 0" en vez de un error.
-- El cliente tiene que tratar 0 filas afectadas como "plazo cerrado".
drop policy if exists predictions_update_own on public.predictions;
create policy predictions_update_own on public.predictions for update to authenticated
using (
  member_id = any (array(select private.user_member_ids()))
  and private.match_kickoff_at(match_id) > now()
)
with check (
  member_id = any (array(select private.user_member_ids()))
  and private.match_kickoff_at(match_id) > now()
  and private.match_league_id(match_id) = private.member_league_id(member_id)
);

drop policy if exists predictions_delete_own on public.predictions;
create policy predictions_delete_own on public.predictions for delete to authenticated
using (
  member_id = any (array(select private.user_member_ids()))
  and private.match_kickoff_at(match_id) > now()
);
