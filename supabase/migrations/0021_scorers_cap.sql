-- =============================================================================
-- 0021 - No se pueden listar mas goleadores que goles
-- =============================================================================
-- QUE RESUELVE
-- Se sacaban puntos a base de cantidad. La tabla solo topaba la lista en 12
-- nombres y no la ataba al marcador, asi que se podia poner 1-2 y soltar doce
-- goleadores: cada acierto sumaba igual, aunque el marcador no tuviera nada que
-- ver con el partido.
--
-- Medido el 17/08/2026 sobre la jornada 1: cuatro pronosticos con un goleador y
-- un asistente de mas cada uno.
--
-- LA REGLA
-- `cardinality(scorers) <= home + away`, y lo mismo para `assists`. El tope son
-- los goles del PROPIO pronostico y no los del partido, porque esto se comprueba
-- al guardar y entonces el resultado no existe. Ademas es lo coherente con lo
-- que se apuesta: si dices 1-2, estas diciendo que hay tres goles.
--
-- Las asistencias llevan el mismo tope y no el numero de goleadores: un gol
-- puede no tener asistencia, pero no puede tener dos.
--
-- POR QUE `NOT VALID`
-- Hay cuatro filas de la jornada 1 que ya la incumplen. `NOT VALID` aplica la
-- regla a todo lo que se escriba a partir de ahora y NO toca lo ya guardado.
--
-- No se corrigen esas cuatro desde aqui a proposito: recortarle la lista a
-- alguien le cambia los puntos de una jornada ya jugada, y eso lo decide el
-- organizador, no una migracion. Para validarlas mas adelante, cuando se hayan
-- arreglado a mano:
--
--   alter table public.predictions validate constraint predictions_scorers_fit_score;
--
-- La aplicacion ya rechaza estos casos con un mensaje claro antes de llegar
-- aqui (`savePredictionAction`). Esto es la segunda barrera, la que no se puede
-- saltar con un POST a pelo.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.predictions'::regclass
      and conname  = 'predictions_scorers_fit_score'
  ) then
    alter table public.predictions
      add constraint predictions_scorers_fit_score
      check (
        cardinality(scorers) <= home + away
        and cardinality(assists) <= home + away
      )
      not valid;
  end if;
end $$;

comment on constraint predictions_scorers_fit_score on public.predictions is
  'No se pueden listar mas goleadores (ni asistentes) que goles tiene el propio '
  'pronostico. NOT VALID: las cuatro filas de la jornada 1 que la incumplian se '
  'dejan como estaban. Ver la migracion 0021.';
