-- =============================================================================
-- 0005 - RPC de alta y blindaje de `members`
-- =============================================================================

-- ------------------------------------------------------------- join_league ---
-- Existe porque `leagues` no es legible para quien todavia no es miembro: sin
-- esta funcion nadie podria canjear un codigo de invitacion. Es SECURITY
-- DEFINER, asi que el codigo se resuelve por dentro sin exponer la tabla.
--
-- Nota de seguridad: no hay limite de intentos aqui. Si la peña crece, poner un
-- rate limit por usuario delante de esta funcion.

create or replace function public.join_league(
  p_invite_code  text,
  p_display_name text,
  p_avatar_color text default '#7C5CFF'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_league uuid;
  v_member uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if length(trim(coalesce(p_display_name, ''))) = 0 then
    raise exception 'display name required' using errcode = '22023';
  end if;

  select id into v_league
  from public.leagues
  where invite_code = upper(trim(p_invite_code));

  if v_league is null then
    raise exception 'invalid invite code' using errcode = '22023';
  end if;

  insert into public.members (league_id, user_id, display_name, avatar_color)
  values (v_league, (select auth.uid()), trim(p_display_name),
          coalesce(p_avatar_color, '#7C5CFF'))
  -- Reentrar con el mismo codigo actualiza el perfil en vez de fallar.
  on conflict (league_id, user_id) do update
    set display_name = excluded.display_name,
        avatar_color = excluded.avatar_color
  returning id into v_member;

  return v_member;
end $$;

revoke all on function public.join_league(text, text, text) from public, anon;
grant execute on function public.join_league(text, text, text) to authenticated;

-- ------------------------------------------- congelar la identidad del miembro ---
-- La politica members_update_self deja al usuario editar su propia fila. Sin
-- este trigger tambien podria cambiarse `league_id` y colarse en otra peña, o
-- reasignar `user_id`.

create or replace function public.freeze_member_identity() returns trigger
language plpgsql as $$
begin
  if new.league_id is distinct from old.league_id then
    raise exception 'league_id is immutable' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists members_freeze_identity on public.members;
create trigger members_freeze_identity
  before update on public.members
  for each row execute function public.freeze_member_identity();

-- ------------------------------------------- sellado automatico de partidos ---
-- `status` es informativo para la UI (RLS manda sobre kickoff_at), pero conviene
-- que no mienta. Esta funcion la llama un cron o el propio admin.

create or replace function public.refresh_match_statuses(p_league_id uuid default null)
returns int
language sql security invoker as $$
  with updated as (
    update public.matches m
    set status = 'locked'
    from public.gameweeks g
    where g.id = m.gameweek_id
      and (p_league_id is null or g.league_id = p_league_id)
      and m.status = 'open'
      and m.kickoff_at <= now()
    returning m.id
  )
  select count(*)::int from updated
$$;

grant execute on function public.refresh_match_statuses(uuid) to authenticated;
