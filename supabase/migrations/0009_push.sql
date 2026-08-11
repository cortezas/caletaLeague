-- =============================================================================
-- 0009 - Avisos antes del cierre (Web Push)
-- =============================================================================
-- Hasta ahora "Avisos antes del cierre · 1 hora antes" era texto muerto en
-- /ajustes. Esta migracion pone el respaldo real: donde se guardan las
-- suscripciones del navegador y como se decide a quien hay que avisar.
--
-- Revierte parcialmente D15 ("sin service worker en v1"), pero SOLO para
-- notificaciones: `public/sw.js` es un fichero estatico escrito a mano, sin
-- Serwist ni plugins de webpack, y NO cachea nada. Cachear paginas en una app
-- cuyo dato central es "que hora es" seria peor que no tener PWA.
--
-- Dos tablas:
--   push_subscriptions  -> el buzon de cada navegador. Lo gestiona su dueno.
--   push_reminders_sent -> el acuse. Es lo que hace el cron IDEMPOTENTE: sin
--                          esta tabla, un cron cada 15 minutos manda el mismo
--                          aviso cuatro veces y la pena desactiva los avisos.
-- =============================================================================

-- ----------------------------------------------------- push_subscriptions ---
-- Una fila por navegador, no por persona: el mismo companero puede tener el
-- movil y el portatil. El `endpoint` que devuelve el navegador ya es unico
-- global (lleva el identificador del servicio de push), asi que sirve de clave
-- natural para el upsert desde /api/push/subscribe.

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  endpoint   text not null unique,
  -- Claves de cifrado del navegador (base64url). El payload viaja cifrado
  -- extremo a extremo: ni Google ni Apple pueden leer el aviso.
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_member_idx
  on public.push_subscriptions (member_id);

alter table public.push_subscriptions enable row level security;

-- Los privilegios por defecto de Supabase sobre las tablas nuevas de `public`
-- conceden a `authenticated` solo TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, NO
-- select/insert/update/delete (verificado con \dp en la base local). El
-- `grant ... on all tables` de 0003 solo alcanzo a las tablas que existian
-- entonces. Sin estas dos lineas la tabla es inaccesible y las politicas de
-- abajo nunca llegan a evaluarse.
grant select, insert, update, delete on public.push_subscriptions to authenticated;
-- El cron borra las suscripciones que el servicio de push declara muertas
-- (404/410). No necesita nada mas sobre esta tabla.
grant select, delete on public.push_subscriptions to service_role;

-- Cada uno gestiona las suyas. Mismo patron de rendimiento que 0003:
-- `= any (array(select private.f()))`, nunca `in (select private.f())`.

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
for select to authenticated
using ( member_id = any (array(select private.user_member_ids())) );

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
for insert to authenticated
with check ( member_id = any (array(select private.user_member_ids())) );

-- Hace falta UPDATE, no solo INSERT: el upsert por `endpoint` de
-- /api/push/subscribe refresca p256dh/auth cuando el navegador rota las claves
-- (pasa al reinstalar la PWA sin cambiar de endpoint).
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
for update to authenticated
using      ( member_id = any (array(select private.user_member_ids())) )
with check ( member_id = any (array(select private.user_member_ids())) );

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
for delete to authenticated
using ( member_id = any (array(select private.user_member_ids())) );

-- ---------------------------------------------------- push_reminders_sent ---
-- Acuse de "a este ya le he avisado de este partido". La clave primaria
-- compuesta ES el mecanismo: el cron hace INSERT ... ON CONFLICT DO NOTHING
-- RETURNING y solo avisa de las filas que ha conseguido insertar. Si el cron se
-- solapa consigo mismo o el hosting lo dispara dos veces, la segunda pasada
-- inserta 0 filas y no manda nada.
--
-- Nadie mas que el cron la toca: sin politicas, y con los grants revocados.
-- Con RLS activo y cero politicas la tabla ya seria invisible para
-- `authenticated`; el revoke es cinturon y tirantes porque Supabase concede
-- privilegios por defecto sobre las tablas nuevas del esquema public.

create table if not exists public.push_reminders_sent (
  match_id  uuid not null references public.matches (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  sent_at   timestamptz not null default now(),
  primary key (match_id, member_id)
);

alter table public.push_reminders_sent enable row level security;
revoke all on public.push_reminders_sent from anon, authenticated;
grant select, insert, delete on public.push_reminders_sent to service_role;

-- ------------------------------------------------- push_reminder_targets() ---
-- A quien hay que avisar ahora mismo: por cada (partido que cierra dentro del
-- horizonte, miembro de esa liga que NO ha pronosticado), una fila por cada
-- navegador suscrito.
--
-- Vive en `public` porque PostgREST solo publica ese esquema, pero se le
-- REVOCA el execute a anon y authenticated: devuelve endpoints y claves de
-- cifrado de TODA la pena. Solo el cron (service_role) la llama.
--
-- Es SECURITY DEFINER por una razon comprobada, no por comodidad: en esta base
-- `service_role` NO tiene select sobre matches, gameweeks, members ni
-- predictions (los privilegios por defecto le dan Dxtm y nada mas). Con la
-- funcion como invoker, la llamada del cron falla con "permission denied". La
-- alternativa era repartir grants sobre cuatro tablas que no son de este lote;
-- concentrar el privilegio en una funcion con el execute revocado es una
-- superficie mas pequena y mas facil de auditar.
--
-- `set search_path` es obligatorio en toda funcion SECURITY DEFINER: sin el,
-- quien pueda crear un esquema en su search_path secuestra la resolucion de
-- nombres de dentro.

create or replace function public.push_reminder_targets(p_minutes int default 60)
returns table (
  match_id            uuid,
  member_id           uuid,
  league_id           uuid,
  gameweek_number     int,
  home_code           text,
  away_code           text,
  kickoff_at          timestamptz,
  kickoff_provisional boolean,
  endpoint            text,
  p256dh              text,
  auth                text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id, mem.id, g.league_id, g.number,
    m.home_code, m.away_code, m.kickoff_at, m.kickoff_provisional,
    s.endpoint, s.p256dh, s.auth
  from public.matches m
  join public.gameweeks g          on g.id = m.gameweek_id
  join public.members mem          on mem.league_id = g.league_id
  join public.push_subscriptions s on s.member_id = mem.id
  where
    -- `kickoff_at` y no `status`: es la misma fuente de verdad que usan las
    -- politicas RLS de `predictions`. Avisar segun `status` dejaria fuera los
    -- partidos que la ingesta aun no ha marcado como cerrados.
    m.kickoff_at > now()
    and m.kickoff_at <= now() + make_interval(mins => greatest(p_minutes, 1))
    and not exists (
      select 1 from public.predictions p
      where p.match_id = m.id and p.member_id = mem.id
    )
  order by m.kickoff_at, mem.id
$$;

revoke all on function public.push_reminder_targets(int) from public, anon, authenticated;
grant execute on function public.push_reminder_targets(int) to service_role;

comment on function public.push_reminder_targets(int) is
  'Destinatarios de los avisos de cierre: partidos que arrancan dentro de '
  'p_minutes y miembros de esa liga sin pronostico, con sus suscripciones push. '
  'Solo service_role: devuelve endpoints de toda la pena.';
