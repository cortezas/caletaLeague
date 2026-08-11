-- =============================================================================
-- 0010 - Privilegios de tabla para service_role (la ingesta)
-- =============================================================================
-- POR QUE HACE FALTA ESTO
-- `service_role` es BYPASSRLS, y de ahi el malentendido: saltarse RLS NO da
-- privilegios de tabla. Postgres comprueba PRIMERO los GRANT y solo despues las
-- politicas. Sin esta migracion, cualquier escritura de la ingesta contesta
--
--     42501: permission denied for table leagues
--
-- y /api/sync falla a la primera pasada, no en un caso raro.
--
-- La 0003 concedio `... on all tables in schema public to authenticated` y ahi
-- se quedo: `service_role` no aparecia. La 0009 si dio lo suyo a las dos tablas
-- de push, pero eso no alcanza a las cuatro que toca la ingesta.
--
-- QUE TOCA CADA COSA (verificado contra el codigo, no supuesto):
--   ingest.ts   -> leagues (select), gameweeks (select/insert), matches
--                  (select/insert/update/upsert)
--   squads.ts   -> leagues (select), team_squads (select/insert/update)
--
-- NO se concede nada sobre `members` ni `predictions`: la ingesta no las mira, y
-- el cron de avisos llega a los datos de la peña por
-- `public.push_reminder_targets()`, que es SECURITY DEFINER precisamente para
-- que `service_role` no necesite leerlas a pelo. Menos superficie, mejor.
--
-- `service_role` sigue siendo SOLO para la ingesta y el cron (la clave vive en
-- el servidor). El codigo de usuario entra como `authenticated` y contra RLS.
-- =============================================================================

grant select                         on public.leagues     to service_role;
grant select, insert, update         on public.gameweeks   to service_role;
grant select, insert, update, delete on public.matches     to service_role;
grant select, insert, update, delete on public.team_squads to service_role;

-- Los ids de gameweeks y matches son `uuid default gen_random_uuid()`, no
-- secuencias, asi que no hay ninguna `sequence` que conceder aqui.
