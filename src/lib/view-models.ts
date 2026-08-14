/**
 * Contrato entre la capa de datos (`src/lib/data`) y las pantallas.
 *
 * Son EXACTAMENTE los view models de PLAN.md 3.2: ni uno mas, ni uno menos.
 * Cuando la fase C sustituya `mock.ts` por consultas a Supabase, este fichero
 * no cambia; por eso las pantallas no se enteran del cambio de backend.
 */

import type { MatchStatus, Prediction, MatchResult, TeamCode, Scoring } from './types'

export type TeamVM = { code: TeamCode; name: string; color: string; ink: string }

export type MatchRowVM = {
  id: string
  home: TeamVM
  away: TeamVM
  kickoffAt: string          // ISO 8601 UTC
  kickoffLabel: string       // 'Sáb 18:30' ya formateado en Europe/Madrid
  // true mientras LaLiga no haya publicado el horario oficial de ese partido.
  // La interfaz TIENE que distinguirlo: una hora inventada presentada como
  // buena hace que alguien se pierda el cierre de su pronostico.
  kickoffProvisional: boolean
  status: MatchStatus        // 'open' | 'locked' | 'live' | 'played'
  myPrediction: Prediction | null
  result: MatchResult | null
  myPoints: number | null    // null si el partido no esta jugado
  exactHit: boolean          // marcador propio identico al real
  /**
   * Racha del equipo en LaLiga, de `competition_standings` (migracion 0015).
   * NO sale de nuestros `matches`: la racha es de la competicion entera y
   * nuestro calendario solo tiene los partidos que la peña pronostica.
   *
   * VACIOS cuando no hay dato, que hoy es el caso normal: hasta que se juegue la
   * primera jornada la API manda `form: null` para los 20 equipos. Una fila sin
   * racha no pinta nada; nunca se inventa una W.
   */
  homeForm: Array<'W' | 'D' | 'L'>
  awayForm: Array<'W' | 'D' | 'L'>
}

export type GameweekVM = {
  number: number
  competitionLabel: string        // 'LaLiga EA Sports'
  deadlineAt: string | null       // ISO del kickoff del primer partido 'open'; null si no queda ninguno
  deadlineLabel: string | null    // 'Cierra Sevilla–Valencia'
  matches: MatchRowVM[]
  predictedCount: number
  totalCount: number              // matches.length, NUNCA 10 literal
  /**
   * Navegacion entre jornadas. Los limites son las jornadas que EXISTEN en la
   * liga (las sembradas en `gameweeks`), nunca 1 y 38 cableados: una peña con
   * media temporada sembrada no puede ofrecer flechas que no llevan a ningun
   * sitio.
   */
  hasPrev: boolean
  hasNext: boolean
  prevNumber: number | null
  nextNumber: number | null
  /**
   * true si esta es la jornada a la que se entra por defecto, o sea la del
   * cierre mas proximo. Con la jornada 2 metida dentro de la 1 por los
   * aplazamientos del Mundial, "por defecto" ya no es "la primera pendiente":
   * ver `pickDefaultGameweek` en `data/league.ts`.
   */
  isDefault: boolean
}

export type SummaryVM = {
  gameweekNumber: number
  rows: Array<{ index: number; matchId: string; label: string; myScore: string | null; status: MatchStatus; points: number | null }>
  predictedCount: number
  missingCount: number
  firstMissingMatchId: string | null
}

export type PredictEditorVM = {
  match: MatchRowVM
  editable: boolean                       // status === 'open'
  squads: Array<{ code: TeamCode; name: string; color: string; ink: string; players: string[] }>
  /**
   * Nombres distintos que la pena ya ha usado, para autocompletar cuando no hay
   * plantilla. Anadido sobre PLAN.md 3.2: sin plantillas (el plan gratuito de la
   * API no da jugadores) el picker entra en modo texto libre y sin esto escribe
   * a ciegas. Vacio mientras nadie haya escrito ningun nombre.
   */
  suggestions: string[]
  initialDraft: {
    home: number
    away: number
    mvp: string | null
    scorers: string[]
    /** Lista INDEPENDIENTE de `scorers`: el mismo jugador puede marcar y asistir. */
    assists: string[]
    noGoals: boolean
  }
  scoring: Scoring
}

/**
 * De que es cada chip de la fila del pique. Sin esto un nombre de goleador y uno
 * de asistente se pintan igual y no hay forma de saber que apostó cada uno.
 * `noGoals` es la marca explicita de "sin goles", que no es ningun jugador.
 */
export type PiqueChipKind = 'mvp' | 'noGoals' | 'scorer' | 'assist'

export type PiqueVM = {
  match: MatchRowVM                       // con result garantizado no nulo
  highlights: Array<{ value: string; text: string; tone: 'ok' | 'accent' | 'neutral' }>
  rows: Array<{
    memberId: string; displayName: string; avatarColor: string; isMe: boolean
    home: number; away: number; mvp: string | null; scorers: string[]; assists: string[]
    points: number; exact: boolean; signHit: boolean
    chips: Array<{ kind: PiqueChipKind; label: string; hit: boolean }>
  }>
  memberCount: number
}

export type StandingsVM = {
  leagueName: string
  rows: Array<{ position: number; memberId: string; displayName: string; avatarColor: string; points: number; trend: number; isMe: boolean }>
}

export type GameweekStandingsVM = {
  number: number
  hasPrev: boolean
  hasNext: boolean
  statusLabel: string                     // 'En juego · 3 de 10 partidos'
  rows: Array<{
    position: number; memberId: string; displayName: string; avatarColor: string; points: number; isMe: boolean
    breakdown: Array<{ matchId: string; label: string; myScore: string; realScore: string; points: number }>
    pendingCount: number
  }>
}

export type ProfileVM = {
  displayName: string; avatarColor: string
  position: number; memberCount: number; leagueName: string
  totalPoints: number
  stats: { totalPoints: number; exactHits: number; signAccuracy: number; bestGameweekPoints: number; bestGameweekNumber: number }
  chart: Array<{ gameweek: number; points: number }>   // el maximo se calcula en el componente
  streak: { count: number; title: string; text: string } | null
}

export type LeagueSettingsVM = { leagueName: string; inviteCode: string; memberCount: number; isAdmin: boolean; scoring: Scoring; displayName: string; avatarColor: string }

/**
 * `result` trae los goleadores Y los asistentes reales (`MatchResult.assists`),
 * que son las dos listas que el panel de organizador edita. `players` es la union
 * de las dos plantillas: alimenta por igual al MVP, a los goles y a las asistencias.
 */
export type AdminMatchVM = {
  id: string
  label: string
  status: MatchStatus
  result: MatchResult | null
  missingMvp: boolean
  players: string[]
  /** ISO en UTC. Lo que el organizador edita en la pestaña Horarios. */
  kickoffAt: string
  /**
   * true = la hora la fijo el organizador y la ingesta no la toca (0016). Se
   * pinta para que se vea de un vistazo cual sigue a la API y cual no: una hora
   * manual olvidada mandaria el resto de la temporada.
   */
  kickoffManual: boolean
}

/**
 * La jornada que rellena el organizador, con su navegacion.
 *
 * `isDefault` es false cuando se ha ido con `?j=` a una jornada distinta de la
 * que el panel elige solo, que NO es la misma que la de /jornada: la de aqui es
 * la mas antigua con algo pendiente (ver `pickAdminGameweek`), no la que cierra
 * antes. `pendingCount` son los partidos de ESTA jornada sin MVP o sin resultado.
 */
export type AdminGameweekVM = {
  number: number
  matches: AdminMatchVM[]
  hasPrev: boolean; hasNext: boolean; prevNumber: number | null; nextNumber: number | null
  isDefault: boolean
  pendingCount: number
}

/**
 * La alineacion de un partido, para pintar el campo.
 *
 * Sale ENTERA de `public.match_lineups` (la escribe el cron): la pantalla no
 * llama a Highlightly ni una sola vez. Doce personas abriendo el mismo partido
 * serian doce peticiones, y el plan gratuito da 100 AL DIA.
 *
 * `position` ya viene traducida a nuestras cuatro lineas: la API dice
 * 'Goalkeeper'/'Defender'/'Midfielder'/'Forward' y quien traduce es
 * `src/lib/data/lineups.ts`, no el componente.
 */
export type LineupPlayerVM = {
  name: string
  /** Dorsal. `null` cuando la API no lo manda: se pinta el hueco, no un cero. */
  number: number | null
  position: 'GK' | 'DEF' | 'MID' | 'FWD'
}

export type TeamLineupVM = {
  /** '4-3-3'. `null` si la API no la da: entonces se coloca por `position` y ya. */
  formation: string | null
  starters: LineupPlayerVM[]
  substitutes: LineupPlayerVM[]
}

/**
 * `available: false` es el estado NORMAL hasta una hora antes del partido, no un
 * error: las alineaciones oficiales no existen antes. La pantalla dice "No
 * disponible todavia" y explica cuando salen.
 */
export type MatchLineupsVM = {
  available: boolean
  /** ISO de cuando se guardo. `null` mientras no haya nada guardado. */
  fetchedAt: string | null
  home: TeamLineupVM | null
  away: TeamLineupVM | null
}

/**
 * Una fila de `public.team_squads` para el panel de organizador. `source` es lo
 * unico que distingue "De la API" de "Corregida a mano": la ingesta escribe con
 * 'api' y NUNCA pisa una fila 'admin', asi que en cuanto el organizador corrige
 * una plantilla, su version manda.
 */
export type AdminSquadVM = { code: TeamCode; players: string[]; source: 'api' | 'admin' }

/* ------------------------------------------------------------------ *
 * LaLiga de verdad (no la peña)
 *
 * Estos cuatro salen de `competition_standings` y `competition_scorers`
 * (migracion 0015), que llena el cron desde football-data.org. Son datos
 * PUBLICOS de la competicion: no dependen de en que peña estes.
 *
 * `updatedAt` es `null` cuando no hay ni una fila guardada, y las funciones que
 * los devuelven NO LANZAN NUNCA: sin ingesta todavia, `rows: []`. Una pantalla
 * de ayuda que reviente se lleva por delante la pantalla de pronostico, que es
 * la que de verdad hace falta el sabado a las 19:30.
 * ------------------------------------------------------------------ */

/**
 * Una fila de la clasificacion real de LaLiga.
 *
 * `form` va del partido mas antiguo al mas reciente, tal como lo manda la API, y
 * puede estar VACIO: hasta la primera jornada no hay racha que contar.
 * La diferencia de goles no viaja aqui a proposito: es `goalsFor - goalsAgainst`
 * y guardar un tercer numero que puede contradecir a los otros dos solo da
 * ocasiones de que se contradigan.
 */
export type TeamFormVM = {
  code: TeamCode
  position: number
  points: number
  playedGames: number
  goalsFor: number
  goalsAgainst: number
  form: Array<'W' | 'D' | 'L'>
}

export type CompetitionStandingsVM = { updatedAt: string | null; rows: TeamFormVM[] }

/**
 * Un maximo goleador.
 *
 * `teamCode` es `null` cuando su club no es uno de nuestros 20: se muestra el
 * goleador igual (su nombre y sus goles son la ayuda que se pidio) pero sin
 * escudo, porque adivinar el equipo es como acabas metiendo al Mallorca en la
 * fila del Malaga. `assists` a `null` significa "la API no lo da", que NO es
 * cero: la interfaz pinta un hueco, no un 0.
 */
export type TopScorerVM = {
  name: string
  teamCode: TeamCode | null
  goals: number
  assists: number | null
}

export type TopScorersVM = { updatedAt: string | null; rows: TopScorerVM[] }

/**
 * Mi cara a cara contra cada companero de peña.
 *
 * No necesita ninguna API: sale de `gameweek_points` y `prediction_points`, que
 * ya existen. `wins`/`draws`/`losses` se cuentan por JORNADA (cuantas le he
 * ganado, empatado y perdido), no por partido; `pointsFor`/`pointsAgainst` son
 * los puntos acumulados de los dos en las jornadas que se han comparado.
 */
export type HeadToHeadVM = {
  rows: Array<{
    memberId: string
    displayName: string
    avatarColor: string
    wins: number
    draws: number
    losses: number
    pointsFor: number
    pointsAgainst: number
  }>
}
