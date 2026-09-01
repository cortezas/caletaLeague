-- Reacciones a los pronosticos ajenos.
--
-- Los pronosticos se destapan en el pitido inicial y ahi es donde esta el pique.
-- Hasta ahora ese pique se iba entero al WhatsApp; esto lo deja en la app, que es
-- donde estan los datos.
--
-- LA REGLA DEL SECRETO LA IMPONE RLS, no la pantalla. `reactions_insert_own` pide
-- `match_kickoff_at(match_id) <= now()`, que es EXACTAMENTE el complemento de
-- `predictions_select`: no se puede reaccionar a un pronostico que todavia no se
-- puede ver. Mismo momento, misma condicion, y por tanto imposible usar una
-- reaccion para averiguar lo que alguien ha puesto antes de tiempo.
--
-- Lista CERRADA de emojis y no texto libre: un campo de texto que se pinta en la
-- pantalla de los demas es una invitacion, y aqui no hace ninguna falta.
--
-- No hay UPDATE. Cambiar de reaccion es quitar la que hay y poner otra, la misma
-- decision que se tomo con los pagos: el historial cuenta lo que paso.

create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  -- De quien es el pronostico al que se reacciona.
  target_id  uuid not null references public.members (id) on delete cascade,
  -- Quien reacciona.
  member_id  uuid not null references public.members (id) on delete cascade,
  emoji      text not null check (emoji in ('🔥', '💀', '🤡', '👏', '😂', '🧠')),
  created_at timestamptz not null default now(),
  -- La misma persona no puede poner dos veces el mismo emoji al mismo. Puede
  -- poner varios distintos: eso es una opinion mas matizada, no un abuso.
  unique (match_id, target_id, member_id, emoji)
);

create index if not exists reactions_match_idx on public.reactions (match_id);

alter table public.reactions enable row level security;

-- Las ve toda la peña, igual que los pagos y que los propios pronosticos una vez
-- empezado el partido.
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select
  using (private.match_league_id(match_id) in (select id from private.user_league_ids() as id));

-- Reacciono como YO, a alguien de MI peña, y solo con el partido empezado.
drop policy if exists reactions_insert_own on public.reactions;
create policy reactions_insert_own on public.reactions
  for insert
  with check (
    member_id in (select id from private.user_member_ids() as id)
    and private.match_kickoff_at(match_id) <= now()
    and private.match_league_id(match_id) = private.member_league_id(member_id)
    and private.match_league_id(match_id) = private.member_league_id(target_id)
  );

-- Quito las mias y solo las mias.
drop policy if exists reactions_delete_own on public.reactions;
create policy reactions_delete_own on public.reactions
  for delete
  using (member_id in (select id from private.user_member_ids() as id));

comment on table public.reactions is
  'Reacciones a los pronosticos ajenos, solo con el partido ya empezado. Lista cerrada de emojis. Sin update: cambiar es borrar y poner.';
