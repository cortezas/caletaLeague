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

## Alineaciones y avisos

`getLineups` devuelve once y suplentes. `findMissingPicks` cruza eso con los
pronósticos de la peña y devuelve **quién ha apostado por alguien que no está
convocado**.

La idea: un aviso al móvil en la ventana entre que sale la alineación (una hora
antes) y el pitido inicial, que es cuando el pronóstico aún se puede cambiar.

> **Lewandowski no está en el once del Barça.**
> Lo tienes de goleador. Quedan 47 minutos.

**PENDIENTE DE CONFIRMAR:** no sabemos si Highlightly publica la alineación *antes*
del partido. Se ha probado con partidos ya jugados, donde obviamente está. Solo se
puede comprobar en directo, una hora antes de un partido de verdad. Hasta
entonces, el envío de avisos **no está enganchado**: las funciones están listas y
se conectan a `src/lib/push/` cuando se confirme.

## Cómo se ejecuta

Va dentro de `/api/sync`, detrás de la ingesta de football-data.org. Si falta
`HIGHLIGHTLY_API_KEY`, el paso se salta con un aviso y **no rompe** la ingesta
principal, que es la que sostiene el calendario.

El informe de cada pasada trae `events` con: peticiones gastadas, partidos escritos,
tasa de acierto de nombres, fallos de emparejamiento y avisos.
