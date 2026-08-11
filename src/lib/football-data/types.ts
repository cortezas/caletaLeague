/**
 * Tipos de las respuestas de football-data.org **API v4**.
 *
 * Solo estan tipados los campos que esta app consume de verdad. La API devuelve
 * mas cosas (odds, bookings, substitutions, statistics...) y casi todas viven en
 * planes de pago: tiparlas seria decorado.
 *
 * Verificado contra la documentacion oficial v4 (docs.football-data.org):
 *
 *  - El envoltorio de `GET /v4/competitions/{code}/matches` es
 *    `{ filters, resultSet, competition, matches }`.
 *  - `homeTeam`/`awayTeam` en el listado traen `{ id, name, shortName, tla, crest }`.
 *    (En el recurso individual `/v4/matches/{id}` llevan ademas `lineup`, `bench`,
 *    `coach`, `formation` y `statistics`, que el plan GRATUITO no sirve.)
 *  - En v4 los marcadores anidados se llaman `home`/`away`. En v2 se llamaban
 *    `homeTeam`/`awayTeam` y ese fue uno de los cambios rompedores del salto a v4.
 *    Ojo: alguna pagina suelta de la documentacion sigue mostrando el ejemplo
 *    antiguo, por eso `FdScoreLine` declara las dos formas y el lector se queda
 *    con la que venga (ver `readScoreLine` en `ingest.ts`).
 */

/**
 * Estados de partido de la API v4.
 *
 * `TIMED` figura en el enum de la documentacion pero el propio autor anuncio que
 * dejaba de emitirse (el flujo real es SCHEDULED -> IN_PLAY -> PAUSED -> IN_PLAY
 * -> FINISHED). Se mantiene declarado porque no cuesta nada y porque desaparecer
 * de la practica no es lo mismo que desaparecer del contrato.
 *
 * `CANCELLED` aparece escrito con dos eles en la referencia del recurso y con una
 * sola (`CANCELED`) en el blog. Se aceptan las dos grafias.
 *
 * `LIVE` NO es un estado: es un pseudo-valor que solo vale como filtro de consulta
 * y que agrupa IN_PLAY + PAUSED. Nunca llega dentro de un partido.
 */
export type FdMatchStatus =
  | 'SCHEDULED'
  | 'TIMED'
  | 'IN_PLAY'
  | 'PAUSED'
  | 'FINISHED'
  | 'SUSPENDED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'CANCELED'
  | 'AWARDED'

/** Valor admitido en el filtro `status` de la query string (incluye el pseudo `LIVE`). */
export type FdStatusFilter = FdMatchStatus | 'LIVE'

/** Referencia a un equipo tal como viene dentro de un partido del listado. */
export interface FdTeamRef {
  id: number
  /** Nombre largo oficial, p. ej. `Real Betis Balompie`. */
  name: string | null
  /** Nombre corto, p. ej. `Real Betis`. */
  shortName: string | null
  /** Sigla de 3 letras de la API. NO tiene por que coincidir con nuestro `TeamCode`. */
  tla: string | null
  crest: string | null
}

/**
 * Un marcador parcial.
 *
 * `home`/`away` es la forma v4. `homeTeam`/`awayTeam` es la forma v2 y esta aqui
 * solo como red de seguridad de lectura; nunca se escribe.
 */
export interface FdScoreLine {
  home?: number | null
  away?: number | null
  /** @deprecated forma v2, solo lectura defensiva. */
  homeTeam?: number | null
  /** @deprecated forma v2, solo lectura defensiva. */
  awayTeam?: number | null
}

export interface FdScore {
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
  duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT'
  fullTime: FdScoreLine
  halfTime: FdScoreLine
  /** Solo en eliminatorias con prorroga. En liga no aparece. */
  regularTime?: FdScoreLine
  extraTime?: FdScoreLine
  penalties?: FdScoreLine
}

export interface FdMatch {
  /** Identificador estable del partido en football-data.org. Base de nuestro `external_id`. */
  id: number
  /** ISO 8601 en UTC, con `Z`. */
  utcDate: string
  status: FdMatchStatus
  /** Numero de jornada. `null` en competiciones sin jornadas (copas). */
  matchday: number | null
  stage: string
  group: string | null
  lastUpdated: string
  homeTeam: FdTeamRef
  awayTeam: FdTeamRef
  score: FdScore
  /** Minuto en curso. Solo con el partido en juego. */
  minute?: number | null
  injuryTime?: number | null
}

export interface FdCompetitionRef {
  id: number
  name: string
  /** `PD` para LaLiga (Primera Division). */
  code: string
  type: string
  emblem: string | null
}

export interface FdSeasonRef {
  id: number
  startDate: string
  endDate: string
  currentMatchday: number | null
}

/** Respuesta de `GET /v4/competitions/{code}/matches`. */
export interface FdCompetitionMatchesResponse {
  /** Eco de los filtros aplicados. `season` viene como string, p. ej. `"2026"`. */
  filters: {
    season?: string
    matchday?: string
    status?: string
    dateFrom?: string
    dateTo?: string
    stage?: string
    group?: string
  }
  resultSet: {
    count: number
    /** `YYYY-MM-DD` del primer partido del conjunto. */
    first?: string
    last?: string
    played?: number
  }
  competition: FdCompetitionRef
  matches: FdMatch[]
}

/** Cuerpo de error de la API: `{ "message": "...", "errorCode": 403 }`. */
export interface FdErrorBody {
  message?: string
  errorCode?: number
}

/**
 * Cabeceras de cuota que devuelve la API en cada respuesta.
 * El plan gratuito da 10 peticiones por minuto y contesta 429 al pasarse.
 */
export interface FdRateLimit {
  /** `X-Requests-Available-Minute`: peticiones que quedan en el minuto en curso. */
  availableMinute: number | null
  /** `X-RequestCounter-Reset`: segundos hasta que el contador vuelve a cero. */
  resetSeconds: number | null
}
