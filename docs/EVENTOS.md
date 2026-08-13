# Goleadores, asistencias y alineaciones

Segunda fuente de datos, aparte de football-data.org. Resuelve el hueco que aquella
deja: **quién marcó y quién asistió**.

## Qué da cada API

| Dato | football-data.org | Highlightly |
|---|---|---|
| Calendario y horarios | sí | sí |
| Resultado (marcador) | sí | sí |
| Plantillas | sí (20 equipos) | — |
| **Goleadores** | **no** | **sí** |
| **Asistencias** | **no** | **sí** |
| **Alineaciones** | no | **sí** |
| MVP | no | no |

**El MVP no lo da nadie y nunca lo dará.** No es un dato oficial: es un invento de
la peña ("el mejor del partido según nosotros"). Lo mete el organizador y punto.

## Highlightly

- Base: `https://soccer.highlightly.net`, cabecera `x-rapidapi-key`
- Variable: `HIGHLIGHTLY_API_KEY`
- LaLiga es `leagueId=119924`
- **Plan gratuito: 100 peticiones al día**

Endpoints que se usan:

```
GET /matches?leagueId=119924&date=YYYY-MM-DD   localizar el partido
GET /events/{matchId}                          goles y asistencias
GET /lineups/{matchId}                         once inicial y suplentes
```

## Presupuesto de peticiones

El módulo se topa a **40 peticiones por pasada**, muy por debajo del límite diario.
Una jornada completa gasta como mucho: 3-4 para localizar los partidos por fecha,
más 1 por cada partido terminado sin goleadores. Unas 14 por jornada.

**Nunca consulta un partido ya resuelto.** Si `real_scorers` ya tiene contenido, se
salta.

## La regla: lo manual manda

Con dos fuentes escribiendo en las mismas columnas, hace falta saber quién escribió
qué. Para eso está `matches.real_players_source` (migración `0012`), mismo patrón
que `team_squads.source`.

La ingesta solo escribe cuando **las dos listas están vacías y la fila no la escribió
ya la API**:

```sql
update public.matches
   set real_scorers = ..., real_assists = ..., real_players_source = 'api'
 where id = ...
   and real_players_source <> 'api'
   and cardinality(real_scorers) = 0
   and cardinality(real_assists) = 0;
```

Las tres condiciones van en el `WHERE` y las evalúa Postgres, no el proceso: entre
leer y escribir cabe que el organizador haya guardado algo.

Verificado contra la base: con datos manuales el UPDATE afecta a **0 filas**; con las
listas vacías, a **1**.

## Nombres de jugador

Los eventos vienen **abreviados** (`A. Perez`, `N. Pepe`). Las plantillas y las
alineaciones, **completos** (`Ayoze Pérez`, `Nicolas Pépé`).

`resolvePlayerName` empareja inicial + apellido contra la plantilla del equipo,
normalizando acentos y mayúsculas con `normalizePlayer` de `src/lib/squads.ts`.

**Si un nombre no casa con nadie, se guarda tal cual.** Es deliberado: mejor ver
`A. Perez` y corregirlo desde el panel que inventarse que es otro jugador. La tasa
de acierto sale en el informe de cada pasada (`nameMatch`).

## Casos raros, y qué se hace con ellos

- **Goles en propia meta**: detectados y excluidos. Nadie pronostica un gol en
  propia como acierto de goleador.
- **`Penalty` duplicado**: la API a veces manda el mismo gol como `Goal` y como
  `Penalty`. Se deduplica por equipo + minuto + jugador. Cuando pasa, queda un
  aviso en el informe.
- **Partido sin goles**: se marca como resuelto para no volver a consultarlo cada
  hora (`closedGoalless`).
- **Partido que no se puede emparejar**: se registra en `linkFailures` y se salta.
  Nunca se adivina.

## Alineaciones

`getLineups` devuelve once y suplentes.

**Se guardan en nuestra base y la app NUNCA llama a la API.** La tabla es
`public.match_lineups` (migración `0013`), una fila por partido. La razón es la
cuota: doce personas abriendo el mismo partido serían doce peticiones, y el plan
gratuito da 100 **al día**. Quien pide es el cron; la pantalla lee de la tabla
con `getMatchLineups` (`src/lib/data/index.ts`), que nunca lanza ni devuelve
`null`: sin fila guardada devuelve `available: false` y se pinta "Alineaciones
aún no disponibles".

`syncLineups` (`src/lib/highlightly/lineups.ts`) solo pide las de los partidos
que arrancan **en los próximos 90 minutos y que aún no tienen fila**. En cuanto
consigue una, deja de pedirla. Fuera de esa ventana sale antes de llamar a nadie:
cero peticiones.

**PENDIENTE DE CONFIRMAR:** sigue sin saberse si Highlightly publica la alineación
*antes* del partido. Todo lo probado son partidos ya jugados o filas metidas a
mano. Se comprueba mirando la sección `lineups` del informe de `/api/sync` en la
hora previa a un partido de verdad: si repite `not-published` pasada tras pasada,
la API solo las publica con el partido empezado y esta función no sirve para lo
que se pensó.

## Avisos de jugador no convocado

`findMissingPicks` cruza el once con los pronósticos de la peña y devuelve **quién
ha apostado por alguien que no está convocado**.

La idea: un aviso al móvil en la ventana entre que sale la alineación (una hora
antes) y el pitido inicial, que es cuando el pronóstico aún se puede cambiar.

> **Lewandowski no está en el once del Barça.**
> Lo tienes de goleador. Quedan 47 minutos.

Esto **sigue sin estar enganchado**: las funciones están listas y se conectan a
`src/lib/push/` cuando se confirme lo de arriba. Que las alineaciones se guarden
no implica que el aviso se envíe.

## Cómo se ejecuta

Va dentro de `/api/sync`, detrás de la ingesta de football-data.org. Si falta
`HIGHLIGHTLY_API_KEY`, los pasos se saltan con un aviso y **no rompen** la ingesta
principal, que es la que sostiene el calendario.

El informe de cada pasada trae `events` y `lineups` con: peticiones gastadas,
partidos escritos, fallos de emparejamiento y avisos.

Dos frecuencias distintas en `.github/workflows/cron.yml`:

| Pasada | Qué llama | Para qué |
| --- | --- | --- |
| cada 15 min | `/api/sync?squads=0&events=0` | alineaciones: seis oportunidades por partido en vez de dos |
| cada hora (min. 7) | `/api/sync` | calendario, marcadores, plantillas y goleadores |

Gasto de Highlightly por jornada: ~6 peticiones por horario de partido, ~24 en un
sábado de cuatro horarios, ~50 repartidas en tres días. La cuota son 100 **al
día** y la comparten con los goleadores (~14 por jornada). Cabe, pero un sábado
grande deja poco margen: si hiciera falta, `?lineups=0` o `?maxRequests=`.
