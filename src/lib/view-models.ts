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
}

export type GameweekVM = {
  number: number
  competitionLabel: string        // 'LaLiga EA Sports'
  deadlineAt: string | null       // ISO del kickoff del primer partido 'open'; null si no queda ninguno
  deadlineLabel: string | null    // 'Cierra Sevilla–Valencia'
  matches: MatchRowVM[]
  predictedCount: number
  totalCount: number              // matches.length, NUNCA 10 literal
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
export type AdminMatchVM = { id: string; label: string; status: MatchStatus; result: MatchResult | null; missingMvp: boolean; players: string[] }

/**
 * Una fila de `public.team_squads` para el panel de organizador. `source` es lo
 * unico que distingue "De la API" de "Corregida a mano": la ingesta escribe con
 * 'api' y NUNCA pisa una fila 'admin', asi que en cuanto el organizador corrige
 * una plantilla, su version manda.
 */
export type AdminSquadVM = { code: TeamCode; players: string[]; source: 'api' | 'admin' }
