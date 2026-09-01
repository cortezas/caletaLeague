-- Sustituto +: UN nombre puesto, UN acierto como maximo. Nunca dos.
--
-- La migracion 0027 puso un tope al TOTAL (`least(aciertos, nombres_puestos)`) y
-- eso tapaba el caso gordo, pero dejaba pasar el mismo fallo en pequeno: mientras
-- otros nombres de la lista fallen, hay hueco bajo el tope para que UNO solo
-- cobre dos veces.
--
-- Salio en el Barcelona 5-2 Rayo del 31/08/2026. Cinco personas pusieron a
-- Anthony Gordon de asistente. A Gordon lo cambiaron por Karim Adeyemi en el 78'
-- y asistieron LOS DOS: Gordon en el 71' y Adeyemi en el 90'. Con la lista
-- expandida, ese unico nombre casaba con dos asistencias reales y cobraba dos
-- puntos. La pantalla, que reparte los goles de uno en uno (`assignHits` en
-- src/lib/data/gameweek.ts), pintaba UN chip verde. O sea que el pique y los
-- puntos llevaban dias diciendo cosas distintas y solo se veia si los contabas.
--
-- El Sustituto + de bet365 CUBRE la apuesta: si tu jugador o su relevo hace lo
-- que dijiste, tu apuesta esta acertada. Una vez. No es un billete de dos.
--
-- COMO SE CUENTA AHORA, que es exactamente lo que hace la pantalla:
-- se recorren los nombres puestos en orden y cada uno se lleva UNA cosa real, si
-- puede. Se prueba primero el nombre tal cual y solo despues su cadena de
-- relevos, para que cada uno se quede con lo suyo antes de tirar del sustituto.
-- Lo que se lleva uno ya no esta para el siguiente.
--
-- El tope de la 0027 se queda de propina: con este recorrido es imposible pasarse
-- (como mucho un acierto por nombre), asi que ya no hace falta escribirlo.

create or replace function public.hits_subs(
  p_picks    text[],
  p_real     text[],
  p_match_id uuid
) returns integer
language plpgsql
stable
as $fn$
declare
  -- Lo real que queda por repartir, ya normalizado. Se va vaciando.
  quedan text[];
  pick   text;
  cadena text[];
  cand   text;
  pos    int;
  total  int := 0;
begin
  select coalesce(array_agg(public.norm_player(x)), '{}')
    into quedan
  from unnest(coalesce(p_real, '{}')) x
  where public.norm_player(x) is not null;

  foreach pick in array coalesce(p_picks, '{}') loop
    if public.norm_player(pick) is null then
      continue;
    end if;

    -- Primero el nombre tal cual: si acerto por si mismo, no se tira de nadie.
    pos := array_position(quedan, public.norm_player(pick));

    if pos is null then
      -- Y si no, sus relevos. `expand_with_subs` ya trae el tope de saltos y el
      -- guardia de ciclos, asi que aqui no hay forma de colgarse.
      cadena := public.expand_with_subs(array[pick], p_match_id);
      foreach cand in array coalesce(cadena, '{}') loop
        if public.norm_player(cand) is not null then
          pos := array_position(quedan, public.norm_player(cand));
          exit when pos is not null;
        end if;
      end loop;
    end if;

    if pos is not null then
      total := total + 1;
      -- Consumido: ese gol o esa asistencia ya no puede acertarla otro nombre.
      quedan := quedan[1:pos - 1] || quedan[pos + 1:array_length(quedan, 1)];
    end if;
  end loop;

  return total;
end;
$fn$;

comment on function public.hits_subs(text[], text[], uuid) is
  'Aciertos de goleador/asistente con Sustituto +. UN acierto como maximo por nombre puesto, y cada gol o asistencia real se reparte una sola vez. Espejo exacto de assignHits() en src/lib/data/gameweek.ts.';
