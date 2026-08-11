-- =============================================================================
-- Seed: la peña "La Caleta League" con LaLiga EA Sports 2026/27 al completo
-- =============================================================================
-- COMO USARLO
--   1. Aplica primero las 10 migraciones de supabase/migrations/ en orden.
--   2. Registrate en la app con tu correo (magic link) para que exista tu fila
--      en auth.users. Este script NO puede crear usuarios: solo GoTrue puede.
--   3. Cambia el correo de la linea marcada por el tuyo y ejecuta el script.
--   4. Entra en la app: ya eres el administrador de la peña.
--
-- QUE SIEMBRA
--   Las 38 jornadas y los 380 partidos del calendario oficial de la RFEF,
--   transcritos de la constante RAW_CALENDAR de src/lib/laliga.ts. No toques
--   los emparejamientos aqui: si cambian, cambialos alli y vuelve a copiarlos,
--   porque ese fichero es el que valida el reparto (19 en casa y 19 fuera por
--   equipo, sin repeticiones dentro de una jornada).
--
--   Los 11 compañeros restantes NO se siembran: no se pueden inventar filas en
--   auth.users. Se dan de alta solos con el codigo de invitacion CALETA. Hasta
--   entonces la clasificacion tendra un unico participante, que es lo correcto.
--
--   Tampoco se siembra ningun RESULTADO ni ninguna plantilla de jugadores. Los
--   resultados los trae la ingesta de football-data.org; los jugadores los
--   escribe la peña a mano (el plan gratuito no los da).
--
-- ES REEJECUTABLE
--   Reescribe los partidos de cada jornada, asi que perderas los resultados
--   cargados a mano. Los pronosticos de los miembros caen con ellos por el
--   `on delete cascade` de predictions.match_id. Cuidado en produccion.
-- =============================================================================

do $$
declare
  -- >>> CAMBIA ESTO POR TU CORREO <<<
  v_admin_email text := 'raulcgstand@gmail.com';

  v_admin_id  uuid;
  v_league_id uuid;
  v_gw_id     uuid;

  -- Calendario oficial 2026/27, copiado tal cual de RAW_CALENDAR en
  -- src/lib/laliga.ts: `numero|fecha ISO|LOC-VIS,LOC-VIS,...`
  v_calendar text[] := array[
    '1|2026-08-16|ALA-GET,ATM-MAL,CEL-OSA,DEP-ELC,ESP-LEV,BAR-ATH,RAC-VIL,RMA-RSO,SEV-RAY,VAL-BET',
    '2|2026-08-23|ATH-SEV,ATM-VIL,BET-RSO,ELC-BAR,ESP-RMA,GET-RAC,MAL-DEP,OSA-LEV,RAY-ALA,VAL-CEL',
    '3|2026-08-30|ALA-VIL,CEL-ATH,DEP-VAL,BAR-RAY,LEV-BET,OSA-GET,RAC-ELC,RMA-MAL,RSO-ESP,SEV-ATM',
    '4|2026-09-06|ALA-OSA,ATH-ATM,BET-RMA,ELC-RSO,ESP-SEV,GET-CEL,MAL-LEV,RAY-RAC,VAL-BAR,VIL-DEP',
    '5|2026-09-13|ATH-ELC,CEL-MAL,GET-DEP,LEV-BAR,OSA-ESP,RAC-ALA,RMA-RAY,RSO-ATM,SEV-VAL,VIL-BET',
    '6|2026-09-16|ALA-VAL,ATM-OSA,BET-GET,DEP-SEV,ELC-RMA,BAR-RAC,LEV-ATH,MAL-VIL,RAY-ESP,RSO-CEL',
    '7|2026-09-20|ATH-ALA,ATM-RMA,CEL-RAC,DEP-BET,ESP-ELC,GET-MAL,OSA-RAY,SEV-BAR,VAL-RSO,VIL-LEV',
    '8|2026-10-11|ALA-ATM,BET-OSA,ELC-CEL,BAR-GET,LEV-SEV,MAL-ESP,RAC-VAL,RAY-ATH,RMA-VIL,RSO-DEP',
    '9|2026-10-18|BET-BAR,CEL-ALA,DEP-LEV,ESP-ATM,GET-RAY,MAL-RSO,OSA-RAC,RMA-SEV,VAL-ATH,VIL-ELC',
    '10|2026-10-25|ALA-MAL,ATH-GET,ATM-DEP,CEL-BET,BAR-RMA,RAC-ESP,RAY-ELC,RSO-LEV,SEV-OSA,VAL-VIL',
    '11|2026-11-01|ATH-RSO,BET-MAL,DEP-OSA,ELC-VAL,BAR-ALA,GET-SEV,LEV-ATM,RAC-RMA,RAY-CEL,VIL-ESP',
    '12|2026-11-08|ATM-BAR,CEL-LEV,ELC-BET,ESP-DEP,MAL-RAC,OSA-ATH,RSO-RAY,SEV-ALA,VAL-RMA,VIL-GET',
    '13|2026-11-22|ALA-DEP,ATH-ESP,BAR-VIL,GET-ATM,LEV-ELC,OSA-MAL,RAC-RSO,RAY-VAL,RMA-CEL,SEV-BET',
    '14|2026-11-29|BET-RAY,CEL-VIL,DEP-BAR,ELC-ATM,ESP-GET,LEV-RAC,MAL-ATH,RMA-ALA,RSO-SEV,VAL-OSA',
    '15|2026-12-06|ALA-ESP,ATH-RMA,ATM-BET,BAR-CEL,GET-VAL,OSA-ELC,RAC-DEP,RAY-LEV,SEV-MAL,VIL-RSO',
    '16|2026-12-13|ATM-VAL,BET-RAC,DEP-ATH,ELC-SEV,ESP-CEL,LEV-ALA,MAL-BAR,RMA-OSA,RSO-GET,VIL-RAY',
    '17|2026-12-20|ALA-ELC,ATH-BET,CEL-ATM,DEP-RMA,BAR-RSO,GET-LEV,OSA-VIL,RAY-MAL,SEV-RAC,VAL-ESP',
    '18|2027-01-03|BET-ALA,CEL-DEP,ESP-BAR,LEV-VAL,MAL-ELC,RAC-ATH,RAY-ATM,RMA-GET,RSO-OSA,VIL-SEV',
    '19|2027-01-10|ALA-RSO,ATH-VIL,ATM-RAC,DEP-RAY,ELC-GET,ESP-BET,OSA-BAR,RMA-LEV,SEV-CEL,VAL-MAL',
    '20|2027-01-17|ATM-RSO,BET-DEP,CEL-VAL,BAR-ELC,GET-ATH,LEV-ESP,MAL-RMA,RAC-OSA,RAY-SEV,VIL-ALA',
    '21|2027-01-24|ALA-BAR,ATH-LEV,DEP-ATM,ELC-RAY,ESP-VIL,GET-OSA,RAC-CEL,RMA-BET,RSO-MAL,VAL-SEV',
    '22|2027-01-31|ATM-ESP,BET-ELC,CEL-GET,BAR-VAL,LEV-RSO,MAL-ALA,OSA-DEP,RAY-RMA,SEV-ATH,VIL-RAC',
    '23|2027-02-07|ALA-CEL,ATH-OSA,BET-SEV,DEP-MAL,ELC-LEV,ESP-RAY,BAR-ATM,GET-VIL,RSO-RMA,VAL-RAC',
    '24|2027-02-14|CEL-RAY,ELC-DEP,LEV-MAL,OSA-ATM,RAC-GET,RMA-ATH,RSO-BET,SEV-ESP,VAL-ALA,VIL-BAR',
    '25|2027-02-21|ALA-RAC,ATH-CEL,ATM-ELC,DEP-RSO,ESP-OSA,BAR-LEV,MAL-BET,RAY-GET,SEV-RMA,VIL-VAL',
    '26|2027-02-28|ATH-BAR,BET-VIL,CEL-ESP,GET-ALA,LEV-DEP,MAL-ATM,OSA-SEV,RAC-RAY,RMA-VAL,RSO-ELC',
    '27|2027-03-07|ALA-ATH,ATM-CEL,DEP-GET,ELC-MAL,ESP-RAC,BAR-BET,RAY-OSA,SEV-RSO,VAL-LEV,VIL-RMA',
    '28|2027-03-14|ALA-SEV,ATH-VAL,BET-LEV,ELC-VIL,BAR-DEP,GET-RSO,MAL-RAY,OSA-CEL,RAC-ATM,RMA-ESP',
    '29|2027-03-21|ATM-GET,CEL-RMA,ESP-ATH,LEV-OSA,RAC-BET,RAY-BAR,RSO-ALA,SEV-ELC,VAL-DEP,VIL-MAL',
    '30|2027-04-04|ATH-RAC,BET-CEL,DEP-VIL,ELC-ALA,BAR-SEV,GET-ESP,LEV-RAY,MAL-OSA,RMA-ATM,RSO-VAL',
    '31|2027-04-11|ALA-BET,ATM-LEV,CEL-ELC,ESP-MAL,OSA-RMA,RAC-BAR,RAY-RSO,SEV-DEP,VAL-GET,VIL-ATH',
    '32|2027-04-18|ALA-RAY,ATM-SEV,BET-ATH,DEP-CEL,ELC-OSA,BAR-ESP,GET-RMA,LEV-VIL,MAL-VAL,RSO-RAC',
    '33|2027-04-21|ATH-DEP,CEL-BAR,ESP-RSO,GET-BET,OSA-ALA,RAC-MAL,RMA-ELC,SEV-LEV,VAL-RAY,VIL-ATM',
    '34|2027-05-02|ATM-ALA,BET-VAL,CEL-SEV,DEP-RAC,ELC-ESP,BAR-OSA,LEV-RMA,MAL-GET,RAY-VIL,RSO-ATH',
    '35|2027-05-09|ALA-LEV,ATH-MAL,BET-ESP,GET-ELC,OSA-RSO,RAC-SEV,RAY-DEP,RMA-BAR,VAL-ATM,VIL-CEL',
    '36|2027-05-16|ATM-RAY,DEP-ALA,ELC-ATH,ESP-VAL,LEV-GET,MAL-CEL,OSA-BET,RMA-RAC,RSO-BAR,SEV-VIL',
    '37|2027-05-23|ALA-RMA,ATM-ATH,CEL-RSO,DEP-ESP,BAR-MAL,RAC-LEV,RAY-BET,SEV-GET,VAL-ELC,VIL-OSA',
    '38|2027-05-30|ATH-RAY,BET-ATM,ELC-RAC,ESP-ALA,GET-BAR,LEV-CEL,MAL-SEV,OSA-VAL,RMA-DEP,RSO-VIL'
  ];

  -- Horas provisionales en hora de Madrid, una por posicion dentro de la
  -- jornada. Espejo de PROVISIONAL_HOURS en src/lib/laliga.ts. Se reparten a lo
  -- largo del dia para que la jornada no se cierre de golpe: el sellado es por
  -- partido y con los 10 a la misma hora se perderia esa gracia.
  v_hours int[] := array[14, 16, 16, 18, 18, 18, 20, 20, 21, 21];

  -- Horarios YA CONFIRMADOS por LaLiga, en hora de Madrid. Espejo de
  -- OFFICIAL_KICKOFFS en src/lib/laliga.ts: si cambias uno, cambia el otro.
  --
  -- La jornada 1 NO es un fin de semana: va del sabado 15 al jueves 27 de agosto
  -- porque se aplazaron los partidos de Atletico, Valencia, Real Madrid y
  -- Barcelona, que tenian jugadores en las semifinales del Mundial 2026.
  v_kickoffs jsonb := jsonb_build_object(
    '1:ALA-GET', '2026-08-15 19:30',
    '1:SEV-RAY', '2026-08-15 21:30',
    '1:RAC-VIL', '2026-08-16 17:00',
    '1:ESP-LEV', '2026-08-16 19:00',
    '1:CEL-OSA', '2026-08-16 21:30',
    '1:DEP-ELC', '2026-08-17 21:00',
    '1:ATM-MAL', '2026-08-19 21:00',
    '1:VAL-BET', '2026-08-25 21:00',
    '1:RMA-RSO', '2026-08-26 21:00',
    '1:BAR-ATH', '2026-08-27 21:00',
    '2:RAY-ALA', '2026-08-20 21:00',
    '2:MAL-DEP', '2026-08-24 21:30'
  );

  v_line     text;
  v_parts    text[];
  v_number   int;
  v_date     date;
  v_pairs    text[];
  v_i        int;
  v_kick     timestamptz;
  v_official jsonb;
  v_prov     boolean;
  v_matches  int := 0;
begin
  select id into v_admin_id from auth.users where email = v_admin_email;

  -- DESARROLLO LOCAL: `supabase start` arranca con auth.users vacia, asi que no
  -- hay a quien nombrar administrador y el seed no podria correr nunca. Si la
  -- tabla esta COMPLETAMENTE vacia estamos en un entorno recien creado y se crea
  -- un usuario de prueba.
  --
  -- La guarda es que la tabla este vacia, no una variable de entorno: en tu
  -- proyecto de Supabase real ya existe al menos tu usuario en cuanto entras una
  -- vez, asi que esta rama no puede dispararse ahi.
  if v_admin_id is null and not exists (select 1 from auth.users) then
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- CADENA VACIA, NUNCA NULL. Estas cuatro columnas admiten NULL en el
      -- esquema, pero GoTrue (Go) las escanea a `string` y NO sabe leer NULL:
      -- deja la fila envenenada y CUALQUIER operacion de auth -- incluido el
      -- login por enlace magico -- devuelve 500 "Database error finding user".
      -- Es un fallo horrible de diagnosticar porque el esquema parece correcto.
      confirmation_token, recovery_token, email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated', v_admin_email,
      -- Sin contrasena utilizable: la app entra por enlace magico.
      crypt(gen_random_uuid()::text, gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', ''
    )
    returning id into v_admin_id;

    raise notice 'Entorno vacio: creado usuario local de prueba %', v_admin_email;
  end if;

  if v_admin_id is null then
    raise exception
      'No existe ningun usuario con el correo %. Registrate primero en la app.',
      v_admin_email;
  end if;

  -- ------------------------------------------------------------------ liga ---
  insert into public.leagues (name, invite_code, admin_user_id)
  values ('La Caleta League', 'CALETA', v_admin_id)
  on conflict (invite_code) do update set name = excluded.name
  returning id into v_league_id;

  -- El administrador tambien juega.
  insert into public.members (league_id, user_id, display_name, avatar_color)
  values (v_league_id, v_admin_id, 'Raúl C.', '#7C5CFF')
  on conflict (league_id, user_id) do nothing;

  -- ----------------------------------------------- las 38 jornadas completas ---
  foreach v_line in array v_calendar loop
    v_parts  := string_to_array(v_line, '|');
    v_number := v_parts[1]::int;
    v_date   := v_parts[2]::date;
    v_pairs  := string_to_array(v_parts[3], ',');

    -- La jornada abre una semana antes de su primer partido.
    insert into public.gameweeks (league_id, number, opens_at)
    values (
      v_league_id,
      v_number,
      ((v_date - 7)::text || ' 12:00:00')::timestamp at time zone 'Europe/Madrid'
    )
    on conflict (league_id, number) do update set opens_at = excluded.opens_at
    returning id into v_gw_id;

    delete from public.matches where gameweek_id = v_gw_id;

    for v_i in 1 .. array_length(v_pairs, 1) loop
      -- Horario OFICIAL si LaLiga ya lo publico; si no, el provisional.
      -- La clave es 'jornada:LOCAL-VISITANTE', espejo de OFFICIAL_KICKOFFS en
      -- src/lib/laliga.ts.
      v_official := v_kickoffs -> (v_number::text || ':' || v_pairs[v_i]);

      -- `at time zone 'Europe/Madrid'` en vez de un desfase fijo: la temporada
      -- cruza los dos cambios de hora (25-oct-2026 y 28-mar-2027) y con UTC+2
      -- cableado media temporada bailaria una hora.
      if v_official is null then
        v_kick := (v_date::text || ' ' || lpad(v_hours[v_i]::text, 2, '0') || ':00:00')
                    ::timestamp at time zone 'Europe/Madrid';
        v_prov := true;
      else
        v_kick := (v_official #>> '{}')::timestamp at time zone 'Europe/Madrid';
        v_prov := false;
      end if;

      insert into public.matches
        (gameweek_id, position, home_code, away_code, kickoff_at,
         kickoff_provisional, status)
      values (
        v_gw_id,
        v_i,
        split_part(v_pairs[v_i], '-', 1),
        split_part(v_pairs[v_i], '-', 2),
        v_kick,
        v_prov,
        -- El estado sale del reloj, no de una lista a mano. Nunca 'played':
        -- la constraint matches_result_complete exige marcador, y el seed no
        -- inventa resultados. Los partidos ya disputados quedan en 'locked'
        -- hasta que la ingesta les ponga el suyo.
        case
          when v_kick > now()                      then 'open'
          when v_kick > now() - interval '2 hours' then 'live'
          else                                          'locked'
        end
      );

      v_matches := v_matches + 1;
    end loop;
  end loop;

  raise notice
    'Peña lista. Codigo de invitacion: CALETA. Liga: %. Sembrados % partidos en % jornadas.',
    v_league_id, v_matches, array_length(v_calendar, 1);
  raise notice
    'Los resultados y las horas definitivas los trae la ingesta de football-data.org.';
end $$;
