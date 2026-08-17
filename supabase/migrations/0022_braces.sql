-- =============================================================================
-- 0022 - Un doblete vale por dos
-- =============================================================================
-- QUE RESUELVE
-- Los goleadores se contaban con INTERSECT, que DEDUPLICA. Consecuencias:
--
--   - quien acertaba que un jugador marcaba dos cobraba lo mismo que quien
--     decia que marcaba uno;
--   - y daba igual, porque el editor ni siquiera dejaba escribirlo: tocar a un
--     jugador ya marcado lo quitaba.
--
-- LA REGLA NUEVA: se cuenta el MINIMO de las dos listas por jugador. Decir
-- "Ayoze x3" cuando marco dos son dos aciertos, no tres. Los nombres de mas no
-- restan, pero tampoco suman.
--
-- POR QUE NO SE PUEDE ABUSAR
-- Porque el tope de la 0021 sigue en pie: no caben mas goleadores que goles
-- tiene tu pronostico. Repetir a Ayoze tres veces te gasta tres huecos de tu
-- 3-0, asi que apostar por un triplete es apostar de verdad, no rellenar.
--
-- NO CAMBIA NINGUN PUNTO YA REPARTIDO. Comprobado antes de aplicarla: en los
-- cuatro partidos jugados ninguna lista real tiene un nombre repetido, y con
-- listas sin repetidos `min(1,1)` da lo mismo que INTERSECT.
--
-- El espejo en TypeScript es `countHits` en src/lib/scoring.ts. Si se toca una,
-- se toca la otra.
-- =============================================================================

create or replace function public.calc_points(
  scoring  jsonb,
  p_home   int,  p_away int,  p_mvp text, p_scorers text[], p_assists text[],
  r_home   int,  r_away int,  r_mvp text, r_scorers text[], r_assists text[]
) returns int
language sql immutable parallel safe as $$
  select case
    when r_home is null or r_away is null then 0
    else
      -- Marcador: exacto y 1X2 son EXCLUYENTES. Un exacto suma 3, no 3 + 1.
      (case
         when p_home = r_home and p_away = r_away
           then coalesce((scoring ->> 'exact')::int, 0)
         when sign(p_home - p_away) = sign(r_home - r_away)
           then coalesce((scoring ->> 'x2')::int, 0)
         else 0
       end)
      -- MVP, comparado en forma normalizada.
      + (case
           when public.norm_player(p_mvp) is not null
            and public.norm_player(p_mvp) = public.norm_player(r_mvp)
             then coalesce((scoring ->> 'mvp')::int, 0)
           else 0
         end)
      -- Goleadores, CONTANDO LAS VECES. `least` por jugador es lo que hace que
      -- un doblete acertado valga dos y que pasarse no sume de mas.
      + coalesce((scoring ->> 'scorer')::int, 0) * (
          select coalesce(sum(least(pc.veces, rc.veces)), 0)::int
          from (
            select public.norm_player(s) as nombre, count(*) as veces
            from unnest(coalesce(p_scorers, '{}')) s
            where public.norm_player(s) is not null
            group by 1
          ) pc
          join (
            select public.norm_player(s) as nombre, count(*) as veces
            from unnest(coalesce(r_scorers, '{}')) s
            where public.norm_player(s) is not null
            group by 1
          ) rc on rc.nombre = pc.nombre
        )
      -- Asistentes. Mismo criterio, y APARTE de los goles: el mismo jugador
      -- puede aparecer en las dos listas y ahi hay dos aciertos, no uno.
      + coalesce((scoring ->> 'assist')::int, 0) * (
          select coalesce(sum(least(pa.veces, ra.veces)), 0)::int
          from (
            select public.norm_player(a) as nombre, count(*) as veces
            from unnest(coalesce(p_assists, '{}')) a
            where public.norm_player(a) is not null
            group by 1
          ) pa
          join (
            select public.norm_player(a) as nombre, count(*) as veces
            from unnest(coalesce(r_assists, '{}')) a
            where public.norm_player(a) is not null
            group by 1
          ) ra on ra.nombre = pa.nombre
        )
  end
$$;

comment on function public.calc_points is
  'Espejo SQL de scoreMatch() en src/lib/scoring.ts. Exact y x2 son excluyentes. '
  'Goleadores y asistentes se cuentan por VECES (least por jugador): un doblete '
  'acertado vale dos. Ver la migracion 0022.';
