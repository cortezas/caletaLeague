-- =============================================================================
-- 0013 - Alineaciones guardadas (`match_lineups`)
-- =============================================================================
-- POR QUE EXISTE ESTA TABLA
-- Highlightly da 100 peticiones AL DIA en el plan gratuito. Si la pantalla del
-- partido pidiera la alineacion a la API, doce personas abriendo el mismo
-- partido serian doce peticiones, y con abrir cuatro partidos entre todos se
-- acabaria la cuota del dia. La alineacion se pide UNA vez (la pide el cron) y
-- se guarda aqui; la app lee de esta tabla y NUNCA llama a la API.
--
-- UNA FILA POR PARTIDO
-- `match_id` es la clave primaria, no un simple indice: dos alineaciones del
-- mismo partido no significan nada. La segunda escritura no pisa a la primera
-- (la ingesta hace upsert con ignoreDuplicates), asi que el once que se guardo
-- es el que se sirve.
--
-- POR QUE `jsonb` Y NO UNA TABLA DE JUGADORES
-- Esto no se consulta por jugador, ni se cruza con nada, ni se puntua con ello:
-- se lee entero para pintar un campo y ya. Una tabla `match_lineup_players` con
-- 36 filas por partido añadiria un join, una FK y una migracion mas para
-- resolver exactamente el mismo `select ... where match_id = $1`.
--
-- QUE HAY DENTRO DE `home` / `away` (lo escribe `src/lib/highlightly/lineups.ts`)
--   { "apiName": "Barcelona", "code": "BAR", "formation": "4-3-3",
--     "starters":    [{ "name": "...", "number": 1, "position": "Goalkeeper", "id": "123" }, ...],
--     "substitutes": [ ... ] }
--
-- `position` se guarda TAL CUAL lo da la API ('Goalkeeper' | 'Defender' |
-- 'Midfielder' | 'Forward'). La traduccion a nuestro 'GK'|'DEF'|'MID'|'FWD' se
-- hace al LEER, en `src/lib/data/lineups.ts`. Asi, si mañana hay que afinar esa
-- traduccion, se cambia una funcion y no hay que volver a pedir a la API
-- alineaciones de partidos que ya se jugaron.
--
-- REEJECUTABLE: se puede aplicar dos veces seguidas sin cambiar nada.
-- =============================================================================

create table if not exists public.match_lineups (
  match_id   uuid primary key references public.matches (id) on delete cascade,
  home       jsonb not null,
  away       jsonb not null,
  fetched_at timestamptz not null default now(),
  source     text not null default 'api' check (source in ('api', 'admin'))
);

-- El `if not exists` de arriba se salta la tabla ENTERA cuando ya existe,
-- restricciones incluidas. Si en algun entorno la tabla se creo a mano antes de
-- esta migracion, la comprobacion de `source` no existiria y nadie se enteraria.
-- `add constraint` no admite `if not exists`, de ahi el bloque. El nombre es el
-- que genera Postgres para el check en linea, asi que en una instalacion limpia
-- este bloque no hace nada.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.match_lineups'::regclass
      and conname  = 'match_lineups_source_check'
  ) then
    alter table public.match_lineups
      add constraint match_lineups_source_check check (source in ('api', 'admin'));
  end if;
end $$;

comment on table public.match_lineups is
  'Alineaciones guardadas, una fila por partido. Las escribe el cron (/api/sync) '
  'con la service role key; la app SOLO lee de aqui y nunca llama a Highlightly, '
  'porque la cuota del plan gratuito son 100 peticiones al dia.';

comment on column public.match_lineups.home is
  'Once y banquillo del local: { apiName, code, formation, starters[], substitutes[] }. '
  '`position` va como lo da la API (Goalkeeper/Defender/Midfielder/Forward); se '
  'traduce al leer, en src/lib/data/lineups.ts.';

comment on column public.match_lineups.away is 'Igual que `home`, para el visitante.';

comment on column public.match_lineups.fetched_at is
  'Cuando se consiguio la alineacion. La UI lo usa para decir desde cuando esta '
  'publicada; el cron NO lo mira para decidir si vuelve a pedirla: si hay fila, no pide.';

comment on column public.match_lineups.source is
  'api = la trajo el cron de Highlightly. admin = metida a mano. Reservado: hoy '
  'no hay pantalla que escriba a mano, pero la ingesta ya respeta la fila que exista.';

-- ---------------------------------------------------------------- indices ---
-- La clave primaria crea el btree sobre `match_id`, que es el UNICO acceso que
-- existe: `getMatchLineups(matchId)` y el "¿este partido ya tiene fila?" del
-- cron. Cualquier indice extra aqui seria peso muerto en cada escritura.

-- ------------------------------------------------------------------- RLS ---
-- MISMA ESTRICTEZ QUE `matches` EN 0003: un miembro solo ve alineaciones de
-- partidos de SU liga, resuelto con `private.match_league_id()` (0002), que es
-- SECURITY DEFINER y por eso no choca con las politicas de matches/gameweeks.
--
-- Los dos patrones de rendimiento de 0003 se mantienen:
--   1. `(select auth.uid())` envuelto -> se evalua una vez, no por fila.
--   2. `= any (array(select private.f()))` en vez de `in (select private.f())`.
--
-- Los grants de 0003 fueron `on all tables in schema public`, que solo alcanza a
-- las tablas que existian entonces: esta necesita los suyos o RLS ni llega a
-- evaluarse (el usuario choca antes con "permission denied").

alter table public.match_lineups enable row level security;

-- A `authenticated` se le concede SOLO select. No es redundante con la ausencia
-- de politica de escritura: son dos cerrojos distintos y Postgres comprueba
-- primero el GRANT. Aunque alguien añadiera una politica de INSERT por error,
-- sin el grant no se escribe.
grant select on public.match_lineups to authenticated;

drop policy if exists match_lineups_select on public.match_lineups;
create policy match_lineups_select on public.match_lineups for select to authenticated
using ( private.match_league_id(match_id) = any (array(select private.user_league_ids())) );

-- NO hay politica de insert/update/delete a proposito, ni siquiera para el
-- organizador: esto no lo escribe una persona, lo escribe el cron. Quien escribe
-- es `service_role`, que es BYPASSRLS y no pasa por politicas... pero SI por los
-- grants (ese fue el 42501 que documenta 0010), asi que necesita los suyos.
grant select, insert, update, delete on public.match_lineups to service_role;
