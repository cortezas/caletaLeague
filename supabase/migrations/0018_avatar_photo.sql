-- =============================================================================
-- 0018 - Foto de perfil (`members.avatar_url` + bucket `avatars`)
-- =============================================================================
-- QUE RESUELVE
-- Hasta ahora el avatar eran las iniciales sobre uno de los ocho colores. En una
-- peña de 15 que se conocen, la foto es lo que hace que la clasificacion se lea
-- de un vistazo en vez de descifrando siglas.
--
-- EL COLOR NO DESAPARECE
-- `avatar_color` se queda y sigue siendo obligatorio. Es el respaldo de quien no
-- sube foto, el fondo mientras la imagen carga y lo que se ve si el archivo se
-- borra. Sin el, media peña quedaria con huecos grises. La foto es un extra
-- encima del color, nunca su sustituto.
--
-- POR QUE EL BUCKET ES PUBLICO DE LECTURA
-- Son caras de 256 px que ya se ven dentro de la app. Servirlas con URL firmada
-- obligaria a renovar la firma en cada pantalla y a que caduquen en mitad de una
-- sesion, a cambio de proteger algo que no es secreto. Lo que SI importa es que
-- nadie pueda escribir: no se crea ninguna politica de insert/update/delete, asi
-- que `anon` y `authenticated` no pueden tocar el bucket. Sube el servidor con
-- la service role key, despues de comprobar la sesion.
--
-- POR QUE NO SE GUARDA SOLO EL NOMBRE DEL ARCHIVO
-- `avatar_url` lleva la URL publica entera, con un nombre de archivo distinto en
-- cada subida (ver `updateAvatarAction`). Si el nombre fuera fijo, cambiar de
-- foto dejaria la URL igual y medio mundo seguiria viendo la vieja durante dias
-- por la cache del navegador y de la CDN.
-- =============================================================================

-- -------------------------------------------------------------- columna ---

alter table public.members
  add column if not exists avatar_url text;

comment on column public.members.avatar_url is
  'URL publica de la foto de perfil, o NULL si no ha subido ninguna. El nombre '
  'del archivo cambia en cada subida para que no se sirva la anterior cacheada. '
  'avatar_color sigue siendo obligatorio: es el respaldo cuando esto es NULL.';

-- --------------------------------------------------------------- bucket ---

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ------------------------------------------------------------------- RLS ---
-- Solo lectura publica. `create policy` no admite `if not exists`, de ahi el DO.
--
-- No hay politica de escritura A PROPOSITO: sin politica, RLS deniega, y ni
-- `anon` ni `authenticated` pueden subir, reemplazar ni borrar nada. La service
-- role key se salta RLS y es la que usa el servidor, que antes comprueba quien
-- eres. Asi nadie puede cambiarle la foto a otro ni llenar el bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_public_read'
  ) then
    create policy avatars_public_read
      on storage.objects for select
      using (bucket_id = 'avatars');
  end if;
end $$;

-- `members` no necesita nada nuevo: `members_update_self` (0003) ya recorta el
-- UPDATE a la fila propia, y las politicas son por fila, no por columna.

-- ---------------------------------------------------------------- vista ---
-- La clasificacion NO lee de `members`, lee de esta vista, asi que una columna
-- nueva en la tabla no llega sola a la pantalla donde mas se mira la cara de
-- cada uno. Se rehace igual que en la 0004 anadiendo `avatar_url`.
--
-- `security_invoker = true` NO es opcional y por eso se repite: sin el, la vista
-- consultaria con los permisos de quien la creo y se saltaria la RLS de
-- `members`, enseñando las peñas ajenas.
create or replace view public.standings
with (security_invoker = true) as
select
  mem.league_id,
  mem.id as member_id,
  mem.display_name,
  mem.avatar_color,
  coalesce(sum(gp.total_points), 0::bigint)::integer as total_points,
  rank() over (
    partition by mem.league_id
    order by coalesce(sum(gp.total_points), 0::bigint) desc
  )::integer as position,
  -- Al FINAL y no junto a `avatar_color`, que es donde pediria el cuerpo:
  -- `create or replace view` solo admite añadir columnas por el final. Meterla
  -- en medio obliga a `drop view` y a rehacer permisos por una cuestion de
  -- orden que nadie ve.
  mem.avatar_url
from public.members mem
left join public.gameweek_points gp on gp.member_id = mem.id
group by mem.league_id, mem.id, mem.display_name, mem.avatar_color, mem.avatar_url;
