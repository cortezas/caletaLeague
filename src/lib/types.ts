/**
 * Modelo de dominio de La Caleta League.
 *
 * Los nombres siguen el handoff de diseno (design_handoff_pena_laliga/README.md).
 * Nota: el README propone `status: 'open'|'live'|'played'`, pero el prototipo usa
 * cuatro estados. `locked` (cerrado y aun no jugado) es imprescindible: es una de
 * las cinco variantes visuales de la fila de partido.
 */

/**
 * Los 20 de LaLiga EA Sports 2026/27.
 * Respecto a la 25-26 entran DEP, MAL y RAC (ascendidos) y salen Girona,
 * Mallorca y Real Oviedo (descendidos). Ver src/lib/laliga.ts.
 */
export type TeamCode =
  | 'ALA' | 'ATH' | 'ATM' | 'BAR' | 'BET' | 'CEL' | 'DEP' | 'ELC' | 'ESP' | 'GET'
  | 'LEV' | 'MAL' | 'OSA' | 'RAC' | 'RAY' | 'RMA' | 'RSO' | 'SEV' | 'VAL' | 'VIL'

export interface Team {
  /** Nombre corto para las filas de partido. */
  name: string
  /** Color del circulo placeholder. No hay escudos: decision de producto por derechos. */
  color: string
  /** Color de las siglas sobre `color`. */
  ink: string
}

/** Los jugadores se identifican por nombre; en produccion vendran de la API o del admin. */
export type PlayerName = string

export interface Member {
  id: string
  displayName: string
  avatarColor: string
  /** Foto de perfil. Opcional: los datos de demostracion nunca tienen. */
  avatarUrl?: string | null
  isMe?: boolean
}

/**
 * `open`   - admite pronostico, aun no ha empezado
 * `locked` - ha llegado el pitido inicial, sellado, sin datos todavia
 * `live`   - en juego
 * `played` - finalizado y con resultado real
 */
export type MatchStatus = 'open' | 'locked' | 'live' | 'played'

export interface Prediction {
  home: number
  away: number
  mvp: PlayerName | null
  scorers: PlayerName[]
  /** Quien da los pases de gol. Lista aparte de `scorers`: se puede marcar y no ser goleador. */
  assists: PlayerName[]
  /** Marca explicita de "sin goles". Excluyente con `scorers` Y con `assists`. */
  noGoals?: boolean
}

export interface MatchResult {
  home: number
  away: number
  mvp: PlayerName
  scorers: PlayerName[]
  assists: PlayerName[]
}

export interface Match {
  id: string
  home: TeamCode
  away: TeamCode
  /** Instante del pitido inicial. Es el que sella el partido, no la jornada. */
  kickoffAt: string
  /**
   * true mientras LaLiga no haya publicado el horario oficial de ese partido.
   * Los publica 15-20 dias antes de cada jornada, asi que casi toda la
   * temporada esta provisional casi todo el tiempo.
   */
  kickoffProvisional: boolean
  status: MatchStatus
  /** Solo presente cuando `status === 'played'`. */
  result?: MatchResult
}

/** Puntuacion configurable por el organizador. Vive en `leagues.scoring` (jsonb). */
export interface Scoring {
  /** Marcador exacto. */
  exact: number
  /** Solo el signo 1X2. */
  x2: number
  /** MVP del partido. */
  mvp: number
  /** Por cada goleador acertado. */
  scorer: number
  /** Por cada asistente acertado. Vale menos que un gol: es mas facil de repartir. */
  assist: number
  /**
   * Extra por clavar un 0-0, ADEMAS del exacto.
   *
   * Un 0-0 acertado se queda en los puntos del marcador y se acaba ahi: no hay
   * goleador ni asistente que acertar. Sin este extra, poner un 0-0 es renunciar
   * de entrada a lo que se llevan los demas, y por eso no lo ponia nadie.
   */
  goalless: number
  /** Bonus por acertar el 1X2 de los 10 partidos de la jornada. */
  pleno: number
}

export const DEFAULT_SCORING: Scoring = {
  exact: 3,
  x2: 1,
  mvp: 2,
  scorer: 2,
  assist: 1,
  goalless: 3,
  pleno: 5,
}

export interface Gameweek {
  id: string
  number: number
  opensAt: string
  matches: Match[]
}

export type ThemeName = 'dark' | 'light'
