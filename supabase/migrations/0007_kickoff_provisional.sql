-- =============================================================================
-- 0007 - Horarios provisionales frente a horarios oficiales
-- =============================================================================
-- LaLiga publica los horarios concretos 15-20 dias antes de cada jornada. Hasta
-- entonces la app tiene que ensenar ALGO, pero no puede hacerlo pasar por bueno:
-- alguien se perderia el cierre de su pronostico creyendo que jugaba el domingo.
--
-- La jornada 1 de 2026/27 es el ejemplo perfecto de por que esto importa: va del
-- sabado 15 al jueves 27 de agosto porque se aplazaron los partidos de Atletico,
-- Valencia, Real Madrid y Barcelona por el Mundial. Un horario provisional de
-- "todos el domingo" habria sido falso en 4 de 10 partidos.
--
-- OJO: `kickoff_provisional` NO afecta a la RLS. El sellado sigue colgando solo
-- de `kickoff_at <= now()`. Es una etiqueta de confianza para la interfaz, no
-- una regla de negocio: un partido con hora provisional se sella igual cuando
-- esa hora llega.
-- =============================================================================

alter table public.matches
  add column if not exists kickoff_provisional boolean not null default true;

comment on column public.matches.kickoff_provisional is
  'true mientras LaLiga no haya publicado el horario oficial. La ingesta de '
  'football-data.org lo pone a false cuando trae la hora real. No interviene '
  'en las politicas RLS: el sellado depende solo de kickoff_at.';

-- Los partidos que ya han empezado tienen, por definicion, hora buena:
-- se jugaron a esa hora.
update public.matches
set kickoff_provisional = false
where kickoff_at <= now()
  and kickoff_provisional;
