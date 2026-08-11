-- =============================================================================
-- 0001 - Esquema base de La Caleta League
-- =============================================================================
-- Cinco tablas. La regla central del producto (nadie ve el pronostico de otro
-- antes del pitido inicial) NO se implementa aqui sino en 0003_rls.sql: aqui
-- solo se garantiza que exista `matches.kickoff_at`, que es de lo que cuelga.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- leagues ---

create table if not exists public.leagues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 60),
  invite_code   text not null unique check (invite_code ~ '^[A-Z0-9]{4,12}$'),
  -- Claves alineadas con el tipo `Scoring` de src/lib/types.ts.
  scoring       jsonb not null default '{"exact":3,"x2":1,"mvp":2,"scorer":2,"pleno":5}'::jsonb,
  admin_user_id uuid not null references auth.users (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint leagues_scoring_shape check (
    scoring ? 'exact' and scoring ? 'x2' and scoring ? 'mvp'
    and scoring ? 'scorer' and scoring ? 'pleno'
  )
);

-- ---------------------------------------------------------------- members ---

create table if not exists public.members (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 1 and 24),
  avatar_color  text not null default '#7C5CFF' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  joined_at     timestamptz not null default now(),

  -- Una persona, una ficha por peña.
  unique (league_id, user_id)
);

-- -------------------------------------------------------------- gameweeks ---

create table if not exists public.gameweeks (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  number    int  not null check (number between 1 and 60),
  opens_at  timestamptz not null,

  unique (league_id, number)
);

-- ---------------------------------------------------------------- matches ---

create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  gameweek_id  uuid not null references public.gameweeks (id) on delete cascade,
  -- Siglas de 3 letras. No hay escudos ni logos: decision de producto.
  home_code    text not null check (home_code ~ '^[A-Z]{3}$'),
  away_code    text not null check (away_code ~ '^[A-Z]{3}$'),
  kickoff_at   timestamptz not null,
  -- `open` y `locked` son derivables de kickoff_at, pero se materializan para
  -- que la UI no tenga que recalcularlas y para poder forzar estados desde admin.
  status       text not null default 'open'
                 check (status in ('open', 'locked', 'live', 'played')),
  real_home    int  check (real_home between 0 and 99),
  real_away    int  check (real_away between 0 and 99),
  real_mvp     text,
  real_scorers text[] not null default '{}',
  -- Orden dentro de la jornada, para que la lista no dependa de la hora.
  position     int not null default 0,

  constraint matches_distinct_teams check (home_code <> away_code),
  -- Un partido jugado tiene marcador completo o no lo tiene en absoluto.
  constraint matches_result_complete check (
    (status <> 'played') or (real_home is not null and real_away is not null)
  )
);

-- ------------------------------------------------------------ predictions ---

create table if not exists public.predictions (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  home       int  not null check (home between 0 and 9),
  away       int  not null check (away between 0 and 9),
  mvp        text,
  scorers    text[] not null default '{}',
  -- Flag explicito: NO se deduce de cardinality(scorers) = 0. "Sin goles" es una
  -- afirmacion del usuario, "no he elegido goleadores" es otra cosa.
  no_goals   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (match_id, member_id),
  constraint predictions_no_goals_excludes_scorers check (
    not (no_goals and cardinality(scorers) > 0)
  )
);

-- ---------------------------------------------------------------- indices ---

create index if not exists members_user_id_idx     on public.members (user_id);
create index if not exists members_league_id_idx   on public.members (league_id);
create index if not exists gameweeks_league_id_idx on public.gameweeks (league_id);
create index if not exists matches_gameweek_id_idx on public.matches (gameweek_id);
create index if not exists matches_kickoff_at_idx  on public.matches (kickoff_at);
create index if not exists predictions_member_idx  on public.predictions (member_id);
-- unique (match_id, member_id) ya cubre las busquedas por match_id.

-- --------------------------------------------------------------- triggers ---

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists predictions_touch_updated_at on public.predictions;
create trigger predictions_touch_updated_at
  before update on public.predictions
  for each row execute function public.touch_updated_at();
