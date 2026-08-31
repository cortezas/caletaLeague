-- Un codigo personal fijo por persona, para volver a entrar sin depender de nadie.
--
-- POR QUE. Los enlaces magicos solo los puede emitir el organizador, porque
-- Resend todavia envia desde una direccion de pruebas que solo entrega al dueno
-- de la cuenta. Cada vez que a alguien se le cae la sesion tiene que pedirsela
-- por WhatsApp. Con esto se le da un codigo una vez y entra solo.
--
-- EL CODIGO ES LA CONTRASENA DE SUPABASE del usuario. No se inventa un sistema de
-- sesiones nuevo: al generarlo se llama a `admin.updateUserById({ password })` y
-- al entrar a `signInWithPassword`, que es el camino soportado y el que escribe
-- las cookies bien. Aqui solo se guarda para dos cosas: saber A QUIEN pertenece
-- un codigo tecleado (el usuario escribe el codigo y nada mas, no su correo) y
-- poder volver a ensenarselo al organizador cuando alguien lo pierda.
--
-- SE GUARDA EN CLARO, Y ES UNA DECISION, NO UN DESCUIDO. Guardar un hash
-- obligaria a regenerar el codigo cada vez que alguien lo pierde, que es
-- exactamente la molestia que esto viene a quitar. Y la proteccion seria falsa:
-- el codigo viaja por WhatsApp y vive en claro en trece moviles. Lo que si se
-- protege es el acceso: va en `private`, con RLS y SIN NINGUNA POLITICA, asi que
-- ni `authenticated` ni `anon` pueden leerlo. Solo la service role key, que solo
-- usa el servidor.
--
-- NO PUEDE IR EN `public.members`. La politica `members_select` deja que
-- cualquier miembro lea la fila entera de los otros doce: meter el codigo ahi
-- seria repartir las contrasenas de la pena a la pena.

create table if not exists private.access_codes (
  member_id  uuid primary key references public.members (id) on delete cascade,
  -- Ya normalizado: mayusculas y sin separadores. Se compara tal cual.
  code       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.access_codes enable row level security;
-- Sin policies a proposito: nadie con JWT llega aqui. La service role key se
-- salta RLS, pero necesita USAGE sobre el esquema, que por defecto no tiene.
grant usage on schema private to service_role;
grant select, insert, update, delete on private.access_codes to service_role;

comment on table private.access_codes is
  'Codigo personal de acceso. Es la contrasena de Supabase del usuario; aqui se guarda para identificar a quien teclea y para que el organizador pueda reensenarlo. En claro y a proposito: ver la cabecera de la migracion 0028.';

-- Intentos fallidos, SOLO PARA MIRAR. No bloquea.
--
-- Un contador que bloquee es un tiro en el pie: con trece personas, cualquiera
-- que queme los intentos deja fuera a los trece a la vez, y justo el domingo
-- antes del saque. El codigo son 8 caracteres de un alfabeto de 31 (unos 40
-- bits), que para una quiniela privada sobra. Esto existe para poder responder
-- "¿alguien esta probando codigos?" con datos y no con una sensacion.
create table if not exists private.access_code_attempts (
  id         bigint generated always as identity primary key,
  -- Los primeros caracteres, NUNCA el codigo entero: un intento fallido de uno
  -- es casi el codigo bueno de otro si se equivoco en una letra.
  prefix     text not null,
  ok         boolean not null,
  member_id  uuid references public.members (id) on delete set null,
  at         timestamptz not null default now()
);

alter table private.access_code_attempts enable row level security;
grant select, insert on private.access_code_attempts to service_role;
grant usage on sequence private.access_code_attempts_id_seq to service_role;

create index if not exists access_code_attempts_at_idx
  on private.access_code_attempts (at desc);

-- ---------------------------------------------------------------------------
-- Puente: PostgREST no expone el esquema `private`, y no se va a exponer.
-- ---------------------------------------------------------------------------
-- El servidor habla con la base por PostgREST, que solo ve los esquemas
-- publicados. Publicar `private` seria deshacer justo lo que protege estas dos
-- tablas. En su lugar, cuatro funciones en `public`, SECURITY DEFINER, con el
-- EXECUTE quitado a todo el mundo menos a `service_role`: `anon` y
-- `authenticated` no pueden ni llamarlas, asi que desde el navegador no hay
-- superficie ninguna.

create or replace function public.codigo_de_miembro(p_code text)
returns table (member_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $fn$
  select c.member_id, m.user_id
  from private.access_codes c
  join public.members m on m.id = c.member_id
  where c.code = p_code;
$fn$;

create or replace function public.guardar_codigo(p_member_id uuid, p_code text)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $fn$
  insert into private.access_codes (member_id, code)
  values (p_member_id, p_code)
  on conflict (member_id) do update
    set code = excluded.code, updated_at = now();
$fn$;

create or replace function public.codigos_de_la_pena()
returns table (member_id uuid, code text)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $fn$
  select c.member_id, c.code from private.access_codes c;
$fn$;

create or replace function public.anotar_intento(p_prefix text, p_ok boolean, p_member_id uuid)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $fn$
  insert into private.access_code_attempts (prefix, ok, member_id)
  values (p_prefix, p_ok, p_member_id);
$fn$;

revoke all on function public.codigo_de_miembro(text) from public, anon, authenticated;
revoke all on function public.guardar_codigo(uuid, text) from public, anon, authenticated;
revoke all on function public.codigos_de_la_pena() from public, anon, authenticated;
revoke all on function public.anotar_intento(text, boolean, uuid) from public, anon, authenticated;

grant execute on function public.codigo_de_miembro(text) to service_role;
grant execute on function public.guardar_codigo(uuid, text) to service_role;
grant execute on function public.codigos_de_la_pena() to service_role;
grant execute on function public.anotar_intento(text, boolean, uuid) to service_role;
