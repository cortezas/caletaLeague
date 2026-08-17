/**
 * Barrel de la capa de datos: el UNICO import que las pantallas tienen permitido
 * para pedir datos. Ninguna pantalla importa `@/lib/seed` ni `@/lib/data/mock`.
 *
 * Las 9 funciones de PLAN.md 3.4 mantienen su firma EXACTA aunque por debajo ya
 * consulten Supabase: por eso las 11 pantallas no se han enterado del cambio.
 * Un `null` sigue significando "no existe o no es visible para este usuario" y
 * la page responde con `notFound()`.
 *
 * La navegacion entre jornadas añade `getGameweek(n)` y le da a
 * `getGameweekSummary` una jornada opcional. Sin argumento las dos siguen
 * hablando de la jornada POR DEFECTO, que desde los aplazamientos del Mundial ya
 * no es "la primera pendiente" sino la del cierre mas proximo: ver
 * `pickDefaultGameweek` en `data/league.ts`.
 *
 * Cada funcion decide su fuente: con Supabase configurado consulta la base; sin
 * el, cae en `mock.ts`. Ver la cabecera de `data/league.ts`.
 */

export {
  getActiveGameweek,
  getGameweek,
  getGameweekSummary,
  getMatchEditor,
  getMatchPique,
} from './gameweek'
export { getSeasonStandings, getGameweekStandings } from './standings'
export { getProfile } from './profile'
/**
 * `getAdminMatches(n?)` es la unica que NO entra por la jornada por defecto de la
 * peña: el organizador aterriza en la mas antigua que le falte por rellenar, no
 * en la que se cierra antes. El criterio esta en `pickAdminGameweek`, y devuelve
 * `null` (=> `notFound()`) cuando se le pide un numero que no existe.
 */
export { getLeagueSettings, getAdminMatches, getAdminSquads } from './league'

/**
 * Anadidos de la capa real. No sustituyen a ninguna de las 9: alimentan los
 * chips de jugador y el autocompletado del editor de pronostico, que hasta ahora
 * se resolvian con constantes vacias.
 */
export { getSquadsForMatch, getUsedPlayerNames } from './squads'
export type { MatchSquad } from './squads'

/**
 * El once y el banquillo de un partido. Sale de `public.match_lineups`, que
 * llena el cron: la pantalla NO llama a Highlightly (100 peticiones al dia, y
 * doce personas abriendo el mismo partido serian doce). Nunca devuelve `null` ni
 * lanza: sin alineacion guardada devuelve `available: false`, que es el estado
 * normal hasta una hora antes del pitido inicial.
 */
export { getMatchLineups } from './lineups'

/**
 * El cara a cara de la peña. No consulta ninguna API: compara, jornada a
 * jornada, mis puntos de `gameweek_points` con los de cada companero. Sin
 * ninguna jornada terminada devuelve `rows: []`, que es lo que hay hasta que se
 * juegue la primera.
 */
export { getHeadToHead } from './head-to-head'

/**
 * LaLiga de verdad, no la peña. Salen de `competition_standings` y
 * `competition_scorers` (migracion 0015), que llena el cron desde
 * football-data.org: estas dos NO llaman a la API.
 *
 * NO LANZAN NUNCA y no devuelven `null`: sin nada guardado, `rows: []` y
 * `updatedAt: null`. La racha de la fila de partido cuelga de la primera y los
 * goleadores se piden desde la pantalla de pronostico; que una ayuda que falta
 * tumbara esa pantalla seria mucho peor que no tener la ayuda.
 *
 * `getTopScorers()` sin argumento devuelve 10 (la ingesta guarda 30).
 */
export { getCompetitionStandings, getTopScorers } from './competition'
export { getSeasonDues } from './standings'

/** Hay backend pero quien pregunta no es miembro: lo lanzan las 9 funciones. */
export { NoMemberError } from './league'
