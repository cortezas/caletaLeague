-- Mismo resultado que la 0029, pero sin tumbar la clasificacion.
--
-- La 0029 arreglo el doble cobro y de paso multiplico por nueve el tiempo de
-- `standings`: de 254 ms a 2376 ms. Con 334 pronosticos eso ya es feo; con los
-- 3800 de una temporada entera se come el timeout de 8 segundos del rol
-- `authenticated`, que es exactamente lo que tiro la app el fin de semana del
-- 15-17/08/2026. Un arreglo correcto que rompe otra cosa no esta arreglado.
--
-- QUE COSTABA. `expand_with_subs` es una CTE recursiva contra
-- `match_substitutions`, y se llamaba UNA VEZ POR NOMBRE PUESTO: unas dos mil
-- veces por carga de la clasificacion. El trabajo real es ridiculo (229 filas de
-- cambios en toda la temporada); lo caro era arrancar la recursion dos mil veces.
--
-- QUE HACE AHORA. Los cambios del partido se cargan UNA sola vez por llamada, y
-- solo si hace falta -- o sea, solo cuando algun nombre no ha acertado por si
-- mismo. Con eso, un partido sin cambios o una lista que acierta de frente no
-- tocan la tabla en absoluto. La cadena de relevos se recorre luego en memoria
-- con `array_position`, que sobre diez cambios es instantaneo.
--
-- EL RESULTADO NO CAMBIA. Se sigue el mismo recorrido de la 0029: cada nombre se
-- lleva UNA cosa real como mucho, primero se prueba el nombre tal cual y despues
-- su cadena, y lo que se lleva uno ya no esta para el siguiente.
--
-- Y ahora sigue UNA sola rama de la cadena, igual que `hitVia` en la pantalla
-- (src/lib/data/gameweek.ts). `expand_with_subs` se ramificaba si la API mandaba
-- dos cambios con el mismo jugador saliendo, y ahi la pantalla y los puntos
-- podian discrepar. Con esto los dos lados hacen literalmente lo mismo.

create or replace function public.hits_subs(
  p_picks    text[],
  p_real     text[],
  p_match_id uuid
) returns integer
language plpgsql
stable
as $fn$
declare
  -- Lo real que queda por repartir, normalizado. Se va vaciando.
  quedan  text[];
  -- Los cambios del partido, en dos arrays paralelos y ya normalizados.
  salen   text[];
  entran  text[];
  cargado boolean := false;
  pick    text;
  actual  text;
  vistos  text[];
  pos     int;
  idx     int;
  salto   int;
  total   int := 0;
begin
  select coalesce(array_agg(public.norm_player(x)), '{}')
    into quedan
  from unnest(coalesce(p_real, '{}')) x
  where public.norm_player(x) is not null;

  -- Sin goleadores ni asistentes reales no hay nada que acertar.
  if array_length(quedan, 1) is null then
    return 0;
  end if;

  foreach pick in array coalesce(p_picks, '{}') loop
    if public.norm_player(pick) is null then
      continue;
    end if;

    -- Primero el nombre tal cual: si acerto solo, no se tira de nadie.
    pos := array_position(quedan, public.norm_player(pick));

    if pos is null then
      -- Solo aqui se mira la tabla, y solo la primera vez.
      if not cargado then
        select coalesce(array_agg(public.norm_player(s.player_out)), '{}'),
               coalesce(array_agg(public.norm_player(s.player_in)), '{}')
          into salen, entran
        from public.match_substitutions s
        where s.match_id = p_match_id
          and s.player_in is not null
          and s.player_out is not null;
        cargado := true;
      end if;

      actual := public.norm_player(pick);
      vistos := array[actual];
      salto := 0;

      -- Tope de cuatro saltos y lista de vistos, los mismos que tenia
      -- `expand_with_subs` y los mismos que tiene la pantalla: un dato malo
      -- (A sale por B y B sale por A) no puede colgar esto.
      while pos is null and salto < 4 loop
        idx := array_position(salen, actual);
        exit when idx is null;
        actual := entran[idx];
        exit when actual is null or actual = any (vistos);
        vistos := vistos || actual;
        pos := array_position(quedan, actual);
        salto := salto + 1;
      end loop;
    end if;

    if pos is not null then
      total := total + 1;
      quedan := quedan[1:pos - 1] || quedan[pos + 1:array_length(quedan, 1)];
    end if;
  end loop;

  return total;
end;
$fn$;

comment on function public.hits_subs(text[], text[], uuid) is
  'Aciertos de goleador/asistente con Sustituto +. Un acierto como maximo por nombre puesto y cada gol o asistencia real se reparte una sola vez. Espejo exacto de assignHits()/hitVia() en src/lib/data/gameweek.ts.';
