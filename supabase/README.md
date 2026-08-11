# Supabase - La Caleta League

Todo el estado de la peña vive aqui. La regla central del producto (nadie ve el
pronostico de otro antes del pitido inicial) **no** es una decision de interfaz:
es RLS. La pantalla "sellado" es un reflejo de `0003_rls.sql`, no su
implementacion.

## Que hay en cada fichero

| Fichero | Que hace | Si lo saltas |
| --- | --- | --- |
| `migrations/0001_schema.sql` | Las 5 tablas, indices y el trigger de `updated_at`. | No hay nada. |
| `migrations/0002_private.sql` | Esquema `private` con los helpers `security definer` de RLS. | `0003` falla: las politicas los invocan. |
| `migrations/0003_rls.sql` | Row Level Security y los `grant` a `anon` / `authenticated`. | **Cualquier usuario lee los pronosticos de todos.** |
| `migrations/0004_scoring.sql` | `calc_points` y las vistas `prediction_points`, `gameweek_points`, `standings`. | La clasificacion no existe. |
| `migrations/0005_rpc.sql` | `join_league`, congelado de identidad del miembro, `refresh_match_statuses`. | Nadie puede canjear el codigo de invitacion. |
| `migrations/0006_season_2627.sql` | `matches.external_id`, `norm_player` y `calc_points` tolerante a acentos. | La ingesta duplica partidos y "Vinícius" no cuenta como "Vinicius". |
| `migrations/0007_kickoff_provisional.sql` | `matches.kickoff_provisional`: distingue la hora estimada de la confirmada. | La app enseña como oficial una hora que LaLiga aun no ha dado. |
| `migrations/0008_squads.sql` | `team_squads` (plantillas por equipo) con su `source` `api` / `admin`. | No hay chips de jugador: el MVP y los goleadores solo se escriben a mano. |
| `migrations/0009_push.sql` | `push_subscriptions`, `push_reminders_sent` y `push_reminder_targets()`. | "Avisos antes del cierre" vuelve a ser texto muerto. |
| `migrations/0010_service_role_grants.sql` | Los `grant` de tabla que le faltaban a `service_role`. | **La ingesta entera falla con `42501 permission denied`**: `BYPASSRLS` no da privilegios de tabla. |
| `seed.sql` | La peña, la liga `CALETA` y las 38 jornadas / 380 partidos de 2026/27. | La base queda vacia. |

Las migraciones son **acumulativas y ordenadas**. `0006` no repite `0004`: solo
redefine `calc_points` (misma firma) y recrea `prediction_points`. Aplicar `0004`
despues de `0006` revierte la tolerancia a acentos sin avisar.

## Aplicar las migraciones

### Con Supabase CLI (lo normal)

```bash
supabase db push          # proyecto remoto enlazado
supabase db reset         # local: tira, reaplica las 10 y ejecuta seed.sql
```

`supabase db reset` corre `seed.sql` solo, asi que antes hay que haber puesto el
correo (ver mas abajo) y existir en `auth.users`.

### A mano, con psql

El orden es el del nombre del fichero. `ON_ERROR_STOP=1` no es opcional: sin el,
psql sigue adelante despues de un fallo y te deja media migracion aplicada.

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Son idempotentes: todo es `create ... if not exists`, `create or replace` o
`drop policy if exists` + `create policy`. Reaplicar las 10 sobre una base ya
migrada no rompe nada ni pierde datos.

## Ejecutar el seed

`seed.sql` **no puede crear usuarios**: solo GoTrue escribe en `auth.users`.

1. Registrate en la app con tu correo (magic link).
2. Abre `seed.sql` y cambia `v_admin_email` por ese correo.
3. Ejecutalo:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Si el correo no existe el script aborta con un mensaje claro en vez de dejar la
liga a medias.

Que siembra:

- La liga `La Caleta League`, codigo de invitacion **CALETA**, y al admin como
  primer miembro. Los otros 11 se dan de alta solos con ese codigo.
- Las **38 jornadas y los 380 partidos** del calendario oficial de la RFEF,
  copiados de `RAW_CALENDAR` en `src/lib/laliga.ts`.
- **Ningun resultado y ninguna plantilla de jugadores.** Los resultados los trae
  la ingesta; los jugadores los escribe la peña a mano, porque el plan gratuito
  de football-data.org no da futbolistas.

Detalles que conviene saber:

- **Los horarios son provisionales.** LaLiga los publica 15-20 dias antes de cada
  jornada. Aqui se reparten por el dia (14:00, 16:00, 18:00, 20:00, 21:00 hora de
  Madrid) para que la jornada no se cierre de golpe, y se calculan con
  `at time zone 'Europe/Madrid'`, no con un desfase fijo: la temporada cruza los
  dos cambios de hora (25-oct-2026 y 28-mar-2027).
- **El `status` sale del reloj**, no de una lista escrita a mano: futuro `open`,
  empezado hace menos de 2 h `live`, y el resto `locked`. Nunca `played`: la
  constraint `matches_result_complete` exige marcador y el seed no inventa
  resultados.
- **Es reejecutable, y eso destruye.** Reescribe los partidos de cada jornada, asi
  que se pierden los resultados cargados a mano y, por el `on delete cascade` de
  `predictions.match_id`, **los pronosticos de la peña**. En produccion, no.

Si cambian emparejamientos o fechas, se cambian en `src/lib/laliga.ts` (que es
donde se valida el reparto) y se vuelven a copiar aqui.

## Comparacion de nombres de jugador

`public.norm_player(text)` es el espejo SQL de `normalizePlayer()` en
`src/lib/squads.ts`: minusculas, sin diacriticos, espacios colapsados, trim, y
`NULL` si queda vacio. `calc_points` la usa para el MVP y para los goleadores, asi
que "Vinicius" y "Vinícius" puntuan igual. Si tocas una de las dos, tocas la otra.

Dos cosas no obvias, ambas documentadas en el propio `0006`:

- Se usa `unaccent('unaccent'::regdictionary, x)` (dos argumentos) y no
  `unaccent(x)`, porque es la unica forma que PostgreSQL 17 marca `IMMUTABLE`. En
  15/16 ambas siguen siendo `STABLE`; `norm_player` se declara `immutable` a
  conciencia (PostgreSQL no verifica la volatilidad declarada) porque el
  diccionario es fijo. El unico coste en 15/16 es que no se puede inlinear.
- `norm_player` lleva `set search_path = public, extensions, pg_temp` porque la
  extension `unaccent` acaba en `public` en local y en `extensions` en Supabase.

## Ingesta desde football-data.org

`matches.external_id` (indice unico, admite varios `NULL`) existe para que la
ingesta de `src/lib/football-data/` haga `on conflict (external_id) do update` y
no duplique los 380 partidos en cada pasada.

El seed deja `external_id` a `NULL` a proposito, para no inventar ids que la
fuente externa no reconoceria: es la **primera** pasada de la ingesta la que
reconcilia contra las filas ya sembradas por `(jornada, home_code, away_code)` y
estampa ahi el id de football-data. Verificado contra la base local: la primera
pasada devuelve `adopted: 380` y la tabla se queda en 380 partidos, no en 760.

Que trae el plan gratuito (verificado con un token real): partidos, horarios
definitivos, resultados, clasificacion **y las plantillas de los 20 equipos**.
Que **no** trae: alineaciones, fotos y goleadores por partido. Por eso
`real_mvp` y `real_scorers` se rellenan a mano desde el panel de admin, mientras
que `team_squads` la llena la ingesta.

Las plantillas llegan incompletas: la ficha del Atletico trae 5 jugadores y a
otros equipos les faltan fichajes. Por eso el texto libre sigue disponible
SIEMPRE en el editor, no solo cuando falta la plantilla, y por eso el organizador
puede corregirlas: una fila con `source = 'admin'` la ingesta ya no la pisa
(devuelve el equipo en `preservedByAdmin`).

### Programarla

Una pasada por hora en dia de partido sobra, y el plan gratuito limita a 10
peticiones por minuto. Tres opciones, de menos a mas acoplado a Supabase:

**a) `pg_cron` dentro de la base** — sirve para lo que ya es SQL puro, como
mantener honesto el `status`:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'sellar-partidos',
  '*/10 * * * *',
  $$ select public.refresh_match_statuses() $$
);
```

**b) Supabase Edge Function + Cron** — para la llamada HTTP a football-data.org.
Programala cada hora y que escriba con la `service_role` key (salta RLS; la clave
**no** puede llegar al cliente).

**c) Cron del hosting de Next** — si la app ya corre en un sitio con cron
programado, un route handler protegido por cabecera secreta y una entrada de cron
que lo llame. Es la opcion con menos piezas nuevas.

En las tres, la escritura tiene que ir con `service_role` o con el usuario admin
de la liga: `matches_write_admin` solo deja escribir a quien administra la peña.

## Comprobar los cambios sin Supabase

Las migraciones no dependen de nada de Supabase salvo `auth.users` y `auth.uid()`.
Con un stub de ambos, un `postgres:16-alpine` basta para aplicar las 6 y ejercitar
`calc_points`, que es como se valido `0006`:

```sql
-- stub minimo, SOLO para el test local
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create schema auth;
create extension if not exists pgcrypto;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
```

Casos de referencia con el scoring por defecto
(`{"exact":3,"x2":1,"mvp":2,"scorer":2,"assist":1,"pleno":5}`). Notacion:
`marcador, MVP, {goleadores}, [asistentes]`.

| Pronostico | Real | Puntos | Por que |
| --- | --- | --- | --- |
| 2-1, MVP Tsygankov, {Stuani}, [] | 2-1, MVP Tsygankov, {Tsygankov, Stuani, De Frutos}, [] | **7** | 3 exacto + 2 MVP + 2 de un goleador |
| 0-1, MVP Isco, {Isco}, [] | 0-2, MVP Isco, {Isco, Vitor Roque}, [] | **5** | 1 de 1X2 + 2 MVP + 2 de un goleador |
| 2-0, MVP Kike Garcia, {Kike Garcia}, [] | 1-1, MVP Iago Aspas, {Kike García, Iago Aspas}, [] | **2** | solo el goleador, **y con el acento cambiado** |
| 2-1, MVP Vinicius, {Vinicius}, [Vinicius] | 2-1, MVP Vinícius, {Vinícius}, [Vinícius] | **8** | 3 exacto + 2 MVP + 2 gol + 1 asistencia: **el mismo jugador cuenta en las dos listas** |
| 1-0, MVP Yamal, {Yamal}, [Pedri] | 1-0, MVP Yamal, {Yamal}, [Raphinha] | **7** | 3 + 2 + 2; la asistencia fallada no resta |

El tercero prueba que la tolerancia de acentos funciona (sin `norm_player` daria 0);
el cuarto, que goleadores y asistentes son listas independientes y suman las dos.
