-- =============================================================================
-- 0017 - Que hora dice la API (`kickoff_api_at`), para poder soltar el mando solo
-- =============================================================================
-- QUE RESUELVE
-- La 0016 dejo al organizador fijar la hora de un partido aplazado, porque
-- football-data.org tarda dias en publicarlos. Pero dejo abierto lo dificil:
-- CUANDO se devuelve el mando a la API. Hasta ahora habia que acordarse a mano,
-- y una correccion de agosto olvidada seguiria mandando en abril.
--
-- Peor todavia: si el organizador se equivoca de fecha y despues LaLiga publica
-- otra distinta, su hora incorrecta sigue por encima de la oficial. El partido
-- se cierra cuando no toca y la peña juega contra una hora inventada.
--
-- QUE GUARDA ESTA COLUMNA
-- Lo que decia football-data.org en la ULTIMA pasada, siempre, mande quien mande
-- sobre `kickoff_at`. Es una foto del proveedor, no la hora del partido.
--
-- PARA QUE SIRVE: dos preguntas que sin ella no se pueden contestar.
--
--   1. "¿La API ya coincide con lo que puse a mano?" -> comparar `kickoff_api_at`
--      con `kickoff_at`. Si son iguales no hay nada que proteger y la correccion
--      sobra.
--   2. "¿La API ha publicado algo nuevo?" -> comparar `kickoff_api_at` con lo que
--      trae la pasada de ahora. Si ha cambiado, el proveedor tiene noticias
--      frescas y son mas de fiar que una correccion de hace dias, ACIERTE O NO
--      con la que puso el organizador.
--
-- En los dos casos la ingesta devuelve `kickoff_source` a 'api' ella sola. Esto
-- es lo que hace que el apaño de la 0016 sea temporal por diseño y no por que
-- alguien se acuerde.
--
-- POR QUE ES NULLABLE
-- Las 380 filas que ya existen no tienen foto: nadie la guardaba. Se rellenan
-- solas en la primera pasada del cron. Mientras este a null, la regla 2 no puede
-- evaluarse (no hay con que comparar) y solo actua la 1, que es la conservadora:
-- no soltar el mando. Eso es justo lo que se quiere mientras no se sepa nada.
--
-- LO QUE NO CAMBIA
-- El sellado de la 0001 sigue mandando sobre todo: una hora pasada no se
-- reescribe jamas. Y esta columna NO participa en ninguna vista de puntos ni en
-- RLS: es informacion de la ingesta, no del juego.
-- =============================================================================

-- -------------------------------------------------------------- columna ---

alter table public.matches
  add column if not exists kickoff_api_at timestamptz;

comment on column public.matches.kickoff_api_at is
  'Hora que daba football-data.org en la ultima pasada de ingesta, se este '
  'usando o no. Sirve para dos cosas: ver si la API ya coincide con una hora '
  'puesta a mano, y detectar que la API ha publicado un cambio. En cualquiera de '
  'los dos casos la ingesta devuelve kickoff_source a api. NULL = todavia no ha '
  'pasado ninguna ingesta por esta fila.';

-- --------------------------------------------------------------- indices ---
-- Ninguno. Son 380 filas y la ingesta ya las lee por `external_id`.

-- ------------------------------------------------------------------- RLS ---
-- Sin cambios: las politicas de `matches` son por fila, no por columna.
