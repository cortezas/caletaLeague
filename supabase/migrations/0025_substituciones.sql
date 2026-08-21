-- =============================================================================
-- 0025 - Guardar los cambios de cada partido (paso 1 del "Sustituto +")
-- =============================================================================
-- PARA QUE
-- La pena quiere la regla del Sustituto + de las casas de apuestas: si pones a
-- Mariano como goleador, lo cambian por Toni Martinez y marca Toni, te cuenta.
-- Encadena (si a Toni tambien lo cambian, sigue) y NO se aplica al MVP.
--
-- Para eso hace falta saber quien entro por quien, y hoy eso se tira a la basura:
-- `syncMatchEvents` recibe los eventos de tipo 'Substitution' y los ignora en
-- silencio.
--
-- POR QUE ESTA MIGRACION NO IMPLEMENTA LA REGLA
-- Porque la forma del evento NO esta verificada. El tipo `HlEvent` dice, con esas
-- palabras, "forma documentada en el encargo y ASUMIDA aqui": que `player` sea
-- quien entra y `substituted` quien sale es una suposicion. Si estuviera al
-- revés, la regla daria los puntos al que se fue al banquillo, y nadie lo notaria
-- hasta que alguien reclamara.
--
-- Asi que este paso solo MIRA. Se guardan los cambios y, con ellos, el evento
-- ENTERO tal como llego (`raw`), que es lo que permite comprobar cual es cual
-- sin gastar otra peticion de la cuota. La regla de puntos viene despues, con el
-- dato delante.
--
-- `raw` no es basura que sobre: es la unica forma de auditar una decision que
-- reparte puntos. Si algun dia la API cambia el vocabulario, aqui queda la prueba
-- de lo que mandaba.
-- =============================================================================

create table if not exists public.match_substitutions (
  match_id    uuid not null references public.matches(id) on delete cascade,
  -- Minuto del cambio. Texto y no entero: la API manda cosas como "45+2", y
  -- convertirlo a numero aqui perderia el anadido.
  minute      text,
  -- Nuestra INTERPRETACION de los dos nombres, sin verificar todavia.
  player_in   text,
  player_out  text,
  team        text,
  -- El evento entero, tal como llego. Es lo que se mira para verificar.
  raw         jsonb not null,
  fetched_at  timestamptz not null default now(),
  -- Sin clave primaria natural: la API no da id de cambio. El indice unico va
  -- por partido + minuto + los dos nombres, que en un partido real no se repite.
  unique (match_id, minute, player_in, player_out)
);

comment on table public.match_substitutions is
  'Cambios de cada partido, para el Sustituto +. `player_in`/`player_out` son '
  'nuestra interpretacion de los campos de Highlightly y NO estan verificados; '
  '`raw` guarda el evento entero para poder comprobarlo. Ver la migracion 0025.';

create index if not exists match_substitutions_match_idx
  on public.match_substitutions (match_id);

-- Marca de "ya se miraron los cambios de este partido", para no volver a gastar
-- cuota. Va en `matches` y no se deduce de la ausencia de filas: un partido sin
-- cambios (raro pero posible) no tiene ninguna, y sin esto se pediria en cada
-- pasada para siempre.
alter table public.matches
  add column if not exists subs_fetched_at timestamptz;

comment on column public.matches.subs_fetched_at is
  'Cuando se leyeron los cambios de este partido. NULL = sin leer. Distinguirlo '
  'de "no tuvo cambios" evita pedirlo en cada pasada del cron.';

-- ------------------------------------------------------------------- RLS ---
-- Lectura para la peña, escritura solo del cron. Mismo criterio que
-- `match_lineups` (0013): son datos publicos del partido, no de nadie.
alter table public.match_substitutions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'match_substitutions' and policyname = 'match_substitutions_select'
  ) then
    create policy match_substitutions_select
      on public.match_substitutions for select
      to authenticated
      using (true);
  end if;
end $$;

grant select on public.match_substitutions to authenticated;
grant select, insert, update, delete on public.match_substitutions to service_role;
