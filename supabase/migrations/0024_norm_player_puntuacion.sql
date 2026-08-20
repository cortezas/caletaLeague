-- =============================================================================
-- 0024 - Al comparar jugadores, la puntuacion no cuenta
-- =============================================================================
-- QUE RESUELVE
-- `norm_player` quitaba acentos y espacios de mas, pero NO la puntuacion. Asi que
-- para la base de datos "Lee Kang In" y "Lee Kang-In" eran dos futbolistas
-- distintos.
--
-- Eso no es teorico. El 19/08/2026, en el ATM-MAL, Lee Kang-In marco. La API lo
-- escribe CON guion; nuestra plantilla lo tenia con espacio. Comprobado con la
-- funcion de verdad: un pronostico 2-0 eligiendolo como goleador daba 3 puntos
-- (solo el marcador exacto) en vez de 5. Los 2 del goleador se perdian, y la
-- persona no tenia forma de entender por que.
--
-- Y no es un caso aislado: en los resultados de esta temporada ya hay
-- "Pierre-Emerick Aubameyang", "R. Fernandez Jaen" y "M. Rodriguez". Cualquiera
-- de esos escrito con un punto o un guion de mas se queda sin puntuar.
--
-- LA REGLA NUEVA: guiones, puntos, apostrofes y demas cuentan como un espacio, y
-- luego se colapsa. "Lee Kang-In", "Lee Kang In" y "lee  kang  in" son el mismo.
--
-- POR QUE NO ES PELIGROSO JUNTAR DE MAS
-- Para que dos futbolistas DISTINTOS colisionen tendrian que llamarse igual salvo
-- la puntuacion, y entonces ya colisionaban por los acentos. El riesgo real era
-- el contrario: no reconocer al mismo.
--
-- NO CAMBIA NINGUN PUNTO YA REPARTIDO. Comprobado antes de aplicarla, cruzando
-- todos los pronosticos con todos los goleadores reales: no hay ni un solo caso
-- que empiece a coincidir. Nadie habia elegido a Lee Kang-In en ese partido.
--
-- ESPEJO: `normalizePlayer` en src/lib/squads.ts. Si se toca una, se toca la otra
-- -- y las dos tenian el mismo agujero, asi que las dos se arreglan a la vez.
-- =============================================================================

create or replace function public.norm_player(p_name text)
returns text
language sql
immutable
parallel safe
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(
        lower(unaccent('unaccent'::regdictionary, coalesce(p_name, ''))),
        -- Cualquier cosa que no sea letra ni numero pasa a espacio: asi el guion
        -- de "Kang-In" y el punto de "M. Rodriguez" dejan de separar jugadores.
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )),
    ''
  )
$$;

comment on function public.norm_player is
  'Nombre de futbolista en forma comparable: sin acentos, sin puntuacion y con '
  'los espacios colapsados. "Lee Kang-In" = "Lee Kang In". Espejo de '
  'normalizePlayer en src/lib/squads.ts. Ver la migracion 0024.';
