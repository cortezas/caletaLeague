-- =============================================================================
-- 0020 - `current_uid()`: distinguir "no eres de la peña" de "tu sesion ha muerto"
-- =============================================================================
-- QUE RESUELVE
-- El fin de semana del 15-17/08/2026 hubo gente que se quedo fuera dos dias. No
-- veian el login: veian la pantalla de ONBOARDING pidiendoles el codigo de
-- invitacion, teniendo ficha en la peña desde el dia 12. Meter el codigo no
-- arreglaba nada, asi que era un callejon sin salida.
--
-- COMO SE LLEGA AHI
-- `getDataContext()` da por buena la sesion si `getClaims()` devuelve un `sub`,
-- y despues consulta `members`. Si esa consulta vuelve VACIA, concluye "no eres
-- miembro" y manda a /onboarding.
--
-- Pero hay un tercer caso que no contemplaba: que la aplicacion crea que hay
-- sesion y la BASE DE DATOS te vea como anonimo. Pasa cuando el token que viaja
-- a PostgREST esta caducado o no llega -- el refresco vive en el proxy, y si
-- falla (token rotado por otra pestaña, la app abierta desde el viernes) el
-- `sub` sigue en la cookie pero `auth.uid()` es NULL. Con `auth.uid()` NULL la
-- RLS de `members` no devuelve ni una fila, que es exactamente lo mismo que ve
-- alguien que no se ha unido.
--
-- Los dos casos se ven igual desde la aplicacion y necesitan salidas OPUESTAS:
-- uno hay que mandarlo a unirse, al otro a volver a entrar.
--
-- QUE HACE ESTA FUNCION
-- Contestar quien eres PARA LA BASE DE DATOS. Si devuelve NULL con la sesion
-- puesta, la sesion esta muerta y toca /login. Si devuelve tu id, entonces si es
-- verdad que no perteneces a ninguna peña y toca /onboarding.
--
-- POR QUE security INVOKER (y no definer, como el resto de private.*)
-- Justo porque la gracia es que se evalue con las credenciales de quien llama.
-- Un `security definer` correria como el owner y devolveria siempre algo, que es
-- lo contrario de lo que se quiere medir.
--
-- Solo se llama en el camino de fallo, o sea casi nunca: una consulta de mas
-- cuando ya ibamos a redirigir.
-- =============================================================================

create or replace function public.current_uid()
returns uuid
language sql
stable
as $$ select auth.uid() $$;

comment on function public.current_uid is
  'Quien eres para la base de datos. NULL = la sesion no llega a PostgREST '
  'aunque la aplicacion crea que existe. Sirve para no mandar a /onboarding a '
  'quien lo que necesita es volver a entrar. Ver la migracion 0020.';

grant execute on function public.current_uid() to anon, authenticated, service_role;
