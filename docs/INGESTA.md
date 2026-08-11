# Ingesta de partidos, resultados y plantillas (football-data.org)

Como llegan los partidos, los horarios, los resultados reales y **las plantillas
de los 20 equipos** de LaLiga a la base de datos de La Caleta League, como se
programa, y - sobre todo - **que NO cubre**, que es la parte que suele doler.

Ficheros:

```
src/lib/football-data/client.ts   Cliente tipado de la API v4
src/lib/football-data/types.ts    Tipos de las respuestas que se consumen
src/lib/football-data/ingest.ts   Partidos y jornadas -> Supabase
src/lib/football-data/squads.ts   Plantillas -> public.team_squads
src/app/api/sync/route.ts         POST /api/sync, protegido por CRON_SECRET
```

---

## 1. Lo que da y lo que no da el plan gratuito (leelo primero)

Comprobado el **11/08/2026 con un token real**, no con la documentacion:

| Dato | Plan gratuito | De donde sale aqui |
|---|---|---|
| Emparejamientos y jornada | SI | API (`matchday`, `homeTeam`, `awayTeam`) |
| Hora del pitido inicial | SI | API (`utcDate`) |
| Estado del partido | SI | API (`status`), traducido |
| Marcador real | SI | API (`score.fullTime`) |
| Clasificacion | SI | API (hoy no se ingiere: se calcula en SQL) |
| **Plantillas de los 20 equipos** | **SI** | **API (`/competitions/PD/teams` -> `team.squad`)** |
| Goleadores de cada partido | NO | **El organizador, a mano, desde /ajustes/admin** |
| MVP del partido | NO (no existe en la API) | **El organizador, a mano, desde /ajustes/admin** |
| Alineaciones y banquillo | NO | no se usan |
| Fotos de jugador | NO | no hay; la UI pinta chips de texto |

> Correccion de una version anterior de este documento: decia que el plan
> gratuito **no** daba jugadores. Es falso. Las plantillas si vienen, y por eso
> el editor de pronostico puede pintar chips en vez de obligar a escribir a
> ciegas. Lo que de verdad no viene es **quien marco cada gol**, que es un dato
> por partido, no por equipo.

Por eso la ingesta **nunca escribe `matches.real_mvp` ni `matches.real_scorers`**.
Ni siquiera aparecen en el payload del upsert: PostgREST solo actualiza las
columnas que recibe, asi que lo que meta el organizador esta a salvo de cada
pasada del cron.

Y por eso tampoco hay ningun fichero de este repo con listas de futbolistas
escritas a mano. Hubo mercado de verano en 2026; cualquier plantilla escrita de
memoria seria falsa. Las que hay salen de la API o del organizador.

**El texto libre no desaparece.** Las plantillas de la API vienen incompletas
para algunos equipos (ver 2.6), asi que el editor de pronostico ofrece chips
**y** admite escribir el nombre a mano, siempre. Obligar a elegir de la lista
dejaria tirada a media pena.

Otras cosas que la ingesta deliberadamente **no** hace:

- No crea ligas ni miembros. La liga tiene que existir (`supabase/seed.sql`).
- No borra partidos. Si la API deja de devolver uno, el que hay en la base se
  queda; borrarlo se llevaria por delante los pronosticos asociados.
- No pisa una plantilla que haya corregido el organizador (`source='admin'`).
- No borra una plantilla: si la API devuelve un equipo sin jugadores, la fila
  que ya hubiera se queda como esta y sale un aviso.
- No recalcula puntos. Eso es SQL (`calc_points`, migracion 0004).
- No arregla un partido aplazado o anulado. Lo deja en `locked` y avisa; que
  hacer con esos puntos es una decision de la pena, no de un cron.

---

## 2. Como funciona

### 2.1 Una sola peticion

```
GET https://api.football-data.org/v4/competitions/PD/matches
X-Auth-Token: <FOOTBALL_DATA_TOKEN>
```

`PD` es LaLiga (Primera Division). Sin filtros, ese endpoint devuelve **los 380
partidos de la temporada en curso** en una respuesta. Con `?matchday=N` se
refresca una sola jornada, y sigue siendo 1 peticion.

La cuota del plan gratuito es de **10 peticiones por minuto**. Una pasada
completa de `/api/sync` gasta **2**: los partidos y las plantillas (2.6). Con
`?squads=0` gasta **1**.

La API devuelve en cada respuesta `X-Requests-Available-Minute` y
`X-RequestCounter-Reset`; el cliente los lee y los saca en el informe. Al pasarse
contesta `429`, que el cliente marca como reintentable.

Forma de la respuesta v4, verificada contra la documentacion oficial:

```
{ filters: {...}, resultSet: {...}, competition: {...}, matches: [ ... ] }
```

Cada partido trae `id`, `utcDate`, `status`, `matchday`, `homeTeam`, `awayTeam`
y `score`. Los equipos vienen como `{ id, name, shortName, tla, crest }`.

> Detalle que cuesta una tarde si no se sabe: en **v4** los marcadores anidados
> se llaman `home`/`away`. En v2 se llamaban `homeTeam`/`awayTeam`, y alguna
> pagina suelta de la documentacion todavia ensena el ejemplo viejo. El lector
> (`readScoreLine`) acepta las dos formas.

### 2.2 Traduccion de estados

`MatchStatus` de la app es `'open' | 'locked' | 'live' | 'played'`.

| football-data.org | La Caleta | Por que |
|---|---|---|
| `SCHEDULED` | `open` | hay fecha, la hora aun no es firme |
| `TIMED` | `open` | hora confirmada, aun no ha empezado |
| `IN_PLAY` | `live` | rodando |
| `PAUSED` | `live` | descanso; para la pena sigue en juego |
| `FINISHED` | `played` | pitido final con marcador |
| `AWARDED` | `played` | resultado por resolucion federativa |
| `SUSPENDED` | `locked` | sellado y sin resultado |
| `POSTPONED` | `locked` | idem; lo resuelve el organizador |
| `CANCELLED` / `CANCELED` | `locked` | idem; los puntos los anula el organizador |

Dos matices:

- **Correccion temporal.** Un partido que la API todavia llame `SCHEDULED` o
  `TIMED` pero cuya hora ya paso se guarda como `locked`. Sin esto la UI pintaria
  "abierto" un partido ya empezado durante los minutos que la API tarda en
  refrescar.
- **`FINISHED` sin marcador** no se escribe como `played`: la restriccion
  `matches_result_complete` de la migracion 0001 exige marcador completo. Se
  queda en `locked` y sale un aviso en el informe.
- `TIMED` sigue en la traduccion aunque el autor de la API anuncio que dejaba de
  emitirlo. Desaparecer de la practica no es desaparecer del contrato.
- `LIVE` no es un estado, es un pseudo-valor que solo vale como filtro de
  consulta y que agrupa `IN_PLAY` + `PAUSED`. Nunca llega dentro de un partido.

### 2.3 Traduccion de equipos

La `tla` de la API **no** es nuestro `TeamCode`. Coinciden en muchos casos por
casualidad, pero no en los que importan: la API usa `ATL` para el Atletico
(nosotros `ATM`) y `FCB` para el Barcelona (nosotros `BAR`). Emparejar por `tla` a
secas daria partidos con equipos cambiados en silencio.

Resolucion, en este orden:

1. **`TEAM_ID_OVERRIDES`** - mapa explicito por **id numerico** de la API. Es la
   unica forma estable de identificar un club: el id no cambia nunca, el nombre
   si.
2. **`TEAM_ALIASES`** - igualdad exacta del nombre normalizado (minusculas, sin
   acentos, sin puntuacion) contra `name`, `shortName` o `tla`. Comparacion
   exacta, no "contiene": con subcadenas `deportivo` casaria a la vez con el
   Depor y con el Deportivo Alaves.

**`TEAM_ID_OVERRIDES` arranca vacio a proposito.** Los ids numericos de
football-data.org no se pueden deducir: hay que leerlos. La primera pasada de
`/api/sync` los devuelve en `resolvedTeams` (y los que fallen, en
`unknownTeams`), se copian al mapa y desde ese momento el emparejamiento deja de
depender de como escriban el nombre.

**Si aparece un equipo desconocido** (un ascendido nuevo, un rebautizo, un
partido de otra competicion colado):

- se anota en `report.unknownTeams` con su `id`, su `name` y su `tla`,
- ese partido concreto se salta y entra en `report.skipped`,
- **la ingesta sigue y termina bien**. Un equipo raro no puede tumbar la
  sincronizacion de los otros 19.

Arreglarlo es anadir una linea a `TEAM_ID_OVERRIDES` con el id que salio en el
informe.

### 2.4 Idempotencia

La clave es **`matches.external_id`**, con el valor `fd:<id de la API>` (el
prefijo evita colisiones si algun dia entra otra fuente). El upsert va con
`onConflict: 'external_id'`, asi que ejecutar la ingesta veinte veces seguidas
deja exactamente el mismo estado.

`gameweeks` se upserta por `(league_id, number)`, que ya es unico en la migracion
0001. `opens_at` sigue la misma regla que el seed - la jornada abre una semana
antes de su primer partido - y **una jornada que ya abrio no se vuelve a mover**.

`position` (el orden dentro de la jornada) se recalcula por hora de comienzo
efectiva, asi que un partido ya jugado nunca cambia de sitio en la lista.

**Adopcion de los partidos sembrados.** `supabase/seed.sql` mete los 380 partidos
del calendario de `laliga.ts` sin `external_id`. Si la primera sincronizacion no
los reconociera, el upsert por `external_id` no encontraria conflicto y la liga
acabaria con **760 partidos**, con los pronosticos colgando de la mitad que ya no
se usa. Por eso, antes de escribir, cada partido de la API busca su gemelo
sembrado por `(jornada, local, visitante)` y se queda con esa fila: mismo `id`,
mismos pronosticos, ahora con `external_id`. El informe lo cuenta en `adopted`
(380 la primera vez, 0 despues). Un partido sembrado que la API no devuelva se
deja como esta y sale en `warnings`; borrarlo se llevaria por delante pronosticos.

### 2.5 La hora sellada: el invariante que no se toca

> **Un `kickoff_at` que ya paso NO se reescribe jamas.**

Toda la RLS de pronosticos cuelga de esa hora: el pronostico de otro miembro solo
es visible cuando `matches.kickoff_at <= now()`. Si la API corrigiera a
posteriori la hora de un partido ya empezado:

- moviendola hacia adelante, los pronosticos ajenos volverian a ocultarse y,
  peor, se podria pronosticar un partido ya jugado;
- moviendola hacia atras, se destaparian pronosticos antes de tiempo.

Por eso, si el partido que hay en la base tiene `kickoff_at <= now()`, esa hora
manda sobre la de la API pase lo que pase, y el partido cuenta en
`report.kickoffsSealed`. La API solo manda sobre partidos que aun no han
empezado, que es justo el caso util: LaLiga publica los horarios definitivos 15-20
dias antes de cada jornada.

Corolario: si un horario sale mal de verdad, se corrige a mano en Supabase, no
esperando a que el cron lo arregle.

### 2.6 Plantillas (`src/lib/football-data/squads.ts`)

```
GET https://api.football-data.org/v4/competitions/PD/teams
X-Auth-Token: <FOOTBALL_DATA_TOKEN>
```

Una sola peticion devuelve los **20 equipos**, y dentro de cada uno su `squad`
con `{ id, name, position, dateOfBirth, nationality }` por jugador. Solo se
guarda el **nombre**: la pena y el organizador escriben texto, y la comparacion
se hace con `samePlayer()` de `src/lib/squads.ts` (tolerante a acentos,
mayusculas y espacios). La API mezcla estilos - "Vinicius Junior" sin tilde pero
"Militão" con ella - y por eso comparar por igualdad literal no vale.

Cada equipo se traduce a nuestro `TeamCode` con **el mismo `resolveTeamCode` de
`ingest.ts`**: primero `TEAM_ID_OVERRIDES` por id numerico, luego los alias. No
hay un segundo mapa de equipos, y no puede haberlo: dos tablas de emparejamiento
que se desincronizan es un bug que tarda meses en aparecer. Ejemplo real de por
que hace falta el id: la API llama al Depor `RC Deportivo La Coruña` en este
endpoint y `RC Deportivo de La Coruna` en otros; por alias fallaria, por id (560)
nunca.

Destino: `public.team_squads` (migracion 0008), clave `(league_id, team_code)`.

**La regla del `source`, que es todo lo que hay que recordar:**

| `source` | Quien la escribio | La ingesta... |
|---|---|---|
| `api` | este cron | la sobrescribe en cada pasada |
| `admin` | el organizador desde /ajustes/admin | **no la toca jamas** |

El guardia no vive solo en memoria. La ingesta lee primero que filas son del
admin, pero ademas **el UPDATE lleva `source = 'api'` en el WHERE**, evaluado por
Postgres. Sin eso quedaria una ventana - entre la lectura y la escritura - en la
que el organizador da a guardar su correccion y el cron se la lleva por delante
en silencio. Como PostgREST no sabe poner condiciones en el `DO UPDATE` de un
upsert, la escritura va en dos tramos: un `insert ... on conflict do nothing`
para los equipos que aun no tienen fila, y un `update` por equipo, con su
guardia, para los que ya la tienen. Son ~20 updates por pasada; la tabla tiene
exactamente una fila por equipo.

**Plantillas incompletas: es la norma, no un fallo.** Tamanos reales el
11/08/2026: la mayoria entre 23 y 31 jugadores, pero el **Atletico de Madrid
(id 78) trae 5** y el **Racing (id 5335) trae 18**. Es un defecto de la base de
datos de football-data.org, no de esta ingesta. Se hace lo siguiente:

- una plantilla **corta** (< 18) **si se guarda** - son jugadores reales, aunque
  falten - y el equipo sale en `squads.shortSquads` del informe con su tamano;
- una plantilla **vacia** (0 jugadores) **no se guarda**: escribir `{}` encima
  borraria la lista buena que ya hubiera. Sale en `squads.emptySquads`;
- el arreglo definitivo lo da el organizador completandola desde /ajustes/admin:
  al hacerlo la fila pasa a `source='admin'` y deja de sobrescribirse.

Los nombres se limpian antes de guardar: se recortan, se tiran los vacios y se
quitan duplicados comparando con `normalizePlayer` (la misma normalizacion con
la que luego se puntua). Se conserva la primera grafia y el orden de la API, que
viene por posicion: porteros, defensas, medios, delanteros.

`syncSquads()` **nunca lanza**. Devuelve siempre un informe y mete el fallo en
`squads.error`. Es deliberado: que football-data.org se caiga o que falte la
tabla no puede tumbar la sincronizacion de partidos, que es la que hace falta
para poder jugar. Un `FOOTBALL_DATA_TOKEN` ausente sale como error normal y
**no** marcado como reintentable: no se arregla repitiendo la pasada.

---

## 3. Como se dispara

```
POST /api/sync
X-Cron-Secret: <CRON_SECRET>
```

O `Authorization: Bearer <CRON_SECRET>`, que es lo que manda Vercel Cron.

Parametros opcionales de query string:

| Parametro | Efecto |
|---|---|
| `matchday=24` | sincroniza solo esa jornada (sigue siendo 1 peticion) |
| `squads=0` | no toca las plantillas; la pasada gasta 1 peticion en vez de 2 |
| `allowSeasonMismatch=1` | permite ingerir aunque la API sirva otra temporada |

Respuestas:

| Codigo | Cuando |
|---|---|
| `200` | informe de sincronizacion en el cuerpo |
| `400` | `matchday` fuera de 1..38 |
| `401` | secreto ausente o incorrecto |
| `405` | se ha entrado por `GET` (un navegador no dispara una ingesta) |
| `502` | error no reintentable de la API (403, 400...) |
| `503` | falta `CRON_SECRET` o `FOOTBALL_DATA_TOKEN`, o error reintentable (429, 5xx) |
| `500` | fallo de Supabase o de configuracion |

`503` en vez de `500` para lo reintentable es deliberado: la mayoria de servicios
de cron tratan `500` como fallo definitivo y `503` como "vuelve luego".

**Sin `CRON_SECRET` la ruta responde 503 y no hace nada.** Nunca se queda abierta:
es una ruta que escribe resultados y horas de partido. La comparacion del secreto
es de tiempo constante (`timingSafeEqual`).

### 3.1 Ejemplo manual

```bash
curl -X POST 'https://<dominio>/api/sync' -H "X-Cron-Secret: $CRON_SECRET"
curl -X POST 'https://<dominio>/api/sync?matchday=24' -H "X-Cron-Secret: $CRON_SECRET"
```

### 3.2 Cadencia recomendada

| Momento | Frecuencia | Plantillas | Por que |
|---|---|---|---|
| Martes 04:00 | 1 vez | si | LaLiga publica horarios definitivos entre semana |
| Viernes 04:00 | 1 vez | si | ultimo ajuste antes de la jornada |
| Sabado y domingo, 13:00-00:00 | cada 10 min | **no** (`squads=0`) | marcadores en vivo |
| Lunes 04:00 | 1 vez | si | cierre de la jornada |

Las plantillas cambian dos veces al ano (los dos mercados) y los marcadores cada
diez minutos: pedirlas en cada pasada de dia de partido seria gastar la mitad de
la cuota en datos que no se han movido. De ahi `squads=0` los fines de semana.
Aun asi, con 10 peticiones/minuto y 2 por pasada completa, sobra margen.

Con Vercel Cron (`vercel.json`, fuera del alcance de este lote):

```json
{
  "crons": [
    { "path": "/api/sync?squads=0", "schedule": "*/10 13-23 * * 6,0" },
    { "path": "/api/sync", "schedule": "0 4 * * 1,2,5" }
  ]
}
```

Vercel Cron manda `Authorization: Bearer <CRON_SECRET>` automaticamente si la
variable se llama `CRON_SECRET`, que es justo el nombre que usa esta ruta.

---

## 4. Variables de entorno

Todas estan documentadas en `.env.example`. Resumen:

| Variable | Obligatoria para | Nota |
|---|---|---|
| `FOOTBALL_DATA_TOKEN` | la ingesta | sin prefijo `NEXT_PUBLIC_`; si falta, la app funciona con `src/lib/laliga.ts` y solo `/api/sync` da 503 |
| `CRON_SECRET` | la ingesta | genera con `openssl rand -hex 32`; si falta, la ruta da 503 |
| `SUPABASE_SERVICE_ROLE_KEY` | la ingesta | se salta RLS; **jamas** con prefijo `NEXT_PUBLIC_` |
| `SYNC_LEAGUE_ID` | solo con >1 liga | con una sola liga se detecta sola |
| `NEXT_PUBLIC_SUPABASE_URL` | ya existia | reutilizada |

Hace falta la service role key porque el cron no tiene sesion de usuario y las
politicas de `matches`, `gameweeks` y `team_squads` (migraciones 0003 y 0008)
solo dejan escribir al admin `authenticated`. Se usa **exclusivamente** en
`src/lib/football-data/ingest.ts` y `src/lib/football-data/squads.ts`.

---

## 5. Lo que hace falta y no existe todavia

### 5.1 GRANTS para `service_role` (bloquea TODA la ingesta)

**Comprobado contra el Supabase local el 11/08/2026: hoy la ingesta no puede
escribir nada.** Cualquier peticion con la service role key contesta:

```
42501  permission denied for table leagues
hint:  Grant the required privileges to the current role with:
       GRANT SELECT ON public.leagues TO service_role;
```

`service_role` tiene `BYPASSRLS`, si - por eso se usa para el cron -, pero
saltarse RLS no es lo mismo que tener privilegios de tabla: **primero se
comprueban los GRANT y despues las politicas**. Y los grants de la migracion 0003
solo alcanzan a `authenticated`:

```sql
grant select, insert, update, delete on all tables in schema public to authenticated;
```

Falta la linea equivalente para `service_role`. Hace falta una migracion nueva
(no es de este lote; toca `supabase/migrations/`):

```sql
grant select, insert, update, delete
  on public.leagues, public.gameweeks, public.matches, public.team_squads
  to service_role;
```

Mientras tanto, en local se ha aplicado a mano para poder verificar. **Ese
apano se pierde con `npx supabase db reset`**: sin la migracion, la ingesta
volvera a dar `42501` a la primera pasada.

Solo esas cuatro tablas: `service_role` no tiene por que poder escribir en
`predictions` ni en `members`, que son territorio de la pena.

### 5.2 Enganchar la capa de datos

`src/lib/data/*.ts` sigue leyendo lo que lea (mock o Supabase). La ingesta escribe
en `matches`, `gameweeks` y `team_squads`; en cuanto la capa de datos consulte
Supabase de verdad, la UI ve los datos reales sin tocar nada mas.

---

## 6. Informe de sincronizacion

`POST /api/sync` devuelve JSON con:

| Campo | Que dice |
|---|---|
| `apiSeason` / `expectedSeason` | temporada que sirve la API vs. la de `laliga.ts` |
| `fetched` | partidos que devolvio la API |
| `gameweeksUpserted` / `matchesUpserted` | filas escritas |
| `adopted` | partidos sembrados reconocidos y reutilizados en vez de duplicados |
| `kickoffsSealed` | partidos cuya hora NO se toco por estar ya en el pasado |
| `resultsWritten` | partidos con marcador nuevo o corregido |
| `skipped` | partidos descartados, con el motivo |
| `unknownTeams` | equipos sin mapear, con `id`, `name` y `tla` |
| `resolvedTeams` | cada equipo reconocido con su id de la API - **copia esto a `TEAM_ID_OVERRIDES`** |
| `warnings` | anomalias que no impiden terminar |
| `rateLimit` | peticiones restantes en el minuto y segundos hasta el reset |
| `durationMs` | duracion total |
| `squads` | informe de las plantillas, o `null` si se paso `?squads=0` |

Dentro de `squads`:

| Campo | Que dice |
|---|---|
| `ok` / `error` | si la parte de plantillas termino, y por que no si no |
| `teamsFetched` | equipos que devolvio la API (deberian ser 20) |
| `upserted` | **cuantas plantillas se han escrito** |
| `preservedByAdmin` | **codigos que NO se han tocado por ser del organizador** |
| `shortSquads` | **equipos con menos de 18 jugadores**, con su tamano |
| `emptySquads` | equipos sin ningun jugador en la API; no se escriben |
| `unknownTeams` | equipos sin mapear a un `TeamCode` |
| `warnings` | avisos que no impiden terminar |
| `rateLimit` / `durationMs` | cuota y duracion de esta parte |

Ejemplo real de una pasada contra el Supabase local (11/08/2026):

```json
"squads": {
  "ok": true, "teamsFetched": 20, "upserted": 20,
  "preservedByAdmin": [],
  "shortSquads": [{ "code": "ATM", "name": "Club Atletico de Madrid", "size": 5 }],
  "emptySquads": [], "unknownTeams": []
}
```

Un `upserted` de 19 con `preservedByAdmin: ["ATM"]` no es un fallo: significa que
el organizador corrigio la plantilla del Atletico y la ingesta la ha respetado,
que es exactamente lo que tiene que pasar.

**Guarda de temporada:** si la API sirve una temporada distinta a la de
`laliga.ts` (`SEASON = '2026-27'` -> la API responde `"2026"`), la ingesta
**aborta** en vez de escribir. Sobrescribir el calendario bueno con el de otra
temporada es carisimo de deshacer. Se puede forzar con `?allowSeasonMismatch=1`,
y entonces queda anotado en `warnings`.

Las plantillas llevan la misma guarda, con una diferencia: al no lanzar, el
choque de temporada sale como `squads.ok: false` con el motivo en `squads.error`
y la sincronizacion de partidos se da por buena igualmente.
