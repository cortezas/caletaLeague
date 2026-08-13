/**
 * Emparejar los partidos de Highlightly con los nuestros.
 *
 * EL PROBLEMA
 * Highlightly tiene sus propios ids de partido y sus propios nombres de equipo.
 * No comparten NADA con football-data.org: ni ids de partido, ni ids de equipo,
 * ni grafia del nombre del club. El unico puente posible es
 * "mismo dia + mismo local + mismo visitante".
 *
 * LA REGLA QUE NO SE NEGOCIA
 * **Un partido que no case NO se inventa.** Se anota en el informe con el nombre
 * exacto que dio la API y se salta. Escribir los goleadores del partido
 * equivocado es infinitamente peor que no escribir ninguno: nadie lo notaria
 * hasta que la clasificacion estuviera mal, y para entonces ya se habrian
 * repartido puntos.
 *
 * POR QUE EL DIA Y NO LA HORA
 * La hora exacta baila entre proveedores (uno pone el pitido inicial, otro la
 * apertura de puertas) y ademas nuestros `kickoff_at` pueden venir sellados de
 * antes. El dia natural en Europe/Madrid es estable. Y como no esta verificado
 * en que huso interpreta Highlightly su parametro `date`, el emparejador acepta
 * tambien el dia contiguo: dos partidos de los MISMOS dos equipos en dias
 * consecutivos no existen en una liga de ida y vuelta.
 */

import type { TeamCode } from '@/lib/types'
import type { HlMatch, HlMatchState, HlTeamRef } from './types'

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/**
 * D17: Europe/Madrid fijo. `en-CA` porque es el unico locale de la lista corta
 * que formatea en `YYYY-MM-DD` nativamente, que es justo lo que pide el
 * parametro `date` de la API.
 */
const madridDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** ISO -> 'YYYY-MM-DD' en hora de Madrid. `null` si la fecha no es legible. */
export function madridDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return madridDayFmt.format(new Date(ms))
}

/** Los dias contiguos a uno dado, el propio incluido: ['d-1', 'd', 'd+1']. */
export function neighbouringDays(day: string): string[] {
  const ms = Date.parse(`${day}T12:00:00Z`)
  if (!Number.isFinite(ms)) return [day]
  const DAY_MS = 24 * 60 * 60 * 1000
  return [
    madridDayFmt.format(new Date(ms - DAY_MS)),
    day,
    madridDayFmt.format(new Date(ms + DAY_MS)),
  ]
}

// ---------------------------------------------------------------------------
// Equipos
// ---------------------------------------------------------------------------

/**
 * Nombres de club de Highlightly -> nuestros `TeamCode`.
 *
 * ESTADO DE VERIFICACION: los dos unicos nombres CONFIRMADOS por el encargo son
 * "Atletico Madrid" y "Villarreal". El resto de la lista son las grafias que la
 * API sirve segun la convencion inglesa habitual del sector (sin articulos, sin
 * "CF"/"RCD", sin acentos), mas las variantes razonables. La comparacion es por
 * IGUALDAD EXACTA del nombre normalizado, nunca por "contiene": con subcadenas
 * "deportivo" casaria a la vez con el Depor y con el Deportivo Alaves, y ese es
 * exactamente el bug que no se puede permitir aqui.
 *
 * Un nombre que no este en esta lista NO rompe nada: el partido se salta y sale
 * en `unmatchedApiTeams` del informe con la cadena literal, lista para pegarla
 * aqui. Comprobar y completar esta tabla es el PRIMER paso el sabado 15.
 */
export const HIGHLIGHTLY_TEAM_ALIASES: Record<TeamCode, string[]> = {
  ALA: ['alaves', 'deportivo alaves', 'cd alaves'],
  ATH: ['athletic club', 'athletic bilbao', 'athletic'],
  ATM: ['atletico madrid', 'atletico de madrid', 'club atletico de madrid', 'atl madrid'],
  BAR: ['barcelona', 'fc barcelona'],
  BET: ['real betis', 'betis', 'real betis balompie'],
  CEL: ['celta vigo', 'celta de vigo', 'rc celta de vigo', 'celta'],
  DEP: ['deportivo la coruna', 'deportivo de la coruna', 'rc deportivo', 'rc deportivo de la coruna', 'depor'],
  ELC: ['elche', 'elche cf'],
  ESP: ['espanyol', 'rcd espanyol', 'espanyol barcelona', 'rcd espanyol de barcelona'],
  GET: ['getafe', 'getafe cf'],
  LEV: ['levante', 'levante ud'],
  MAL: ['malaga', 'malaga cf'],
  OSA: ['osasuna', 'ca osasuna'],
  RAC: ['racing santander', 'racing de santander', 'real racing club', 'real racing club de santander', 'racing'],
  RAY: ['rayo vallecano', 'rayo vallecano de madrid', 'rayo'],
  RMA: ['real madrid', 'real madrid cf'],
  RSO: ['real sociedad', 'real sociedad de futbol'],
  SEV: ['sevilla', 'sevilla fc'],
  VAL: ['valencia', 'valencia cf'],
  VIL: ['villarreal', 'villarreal cf'],
}

/** Minusculas, sin diacriticos, sin puntuacion y con los espacios colapsados. */
export function normalizeTeamName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Indice alias -> codigo, construido una vez al importar el modulo. Un alias
 * repetido entre dos equipos emparejaria partidos MAL, asi que salta aqui, en el
 * primer import, y no en produccion un sabado a las nueve de la noche.
 */
const ALIAS_INDEX: Map<string, TeamCode> = (() => {
  const index = new Map<string, TeamCode>()
  for (const [code, aliases] of Object.entries(HIGHLIGHTLY_TEAM_ALIASES) as [TeamCode, string[]][]) {
    for (const alias of aliases) {
      const key = normalizeTeamName(alias)
      const previous = index.get(key)
      if (previous && previous !== code) {
        throw new Error(
          `HIGHLIGHTLY_TEAM_ALIASES: el alias "${alias}" esta asignado a ${previous} y a ${code}.`,
        )
      }
      index.set(key, code)
    }
  }
  return index
})()

/** Nombre de equipo (cadena o `{ name }`) tal cual lo da la API. `null` si no hay. */
export function teamName(ref: HlTeamRef | string | null | undefined): string | null {
  if (typeof ref === 'string') return ref.trim() || null
  const name = ref?.name?.trim()
  return name ? name : null
}

/** `null` si el nombre no esta en la tabla. Nunca adivina. */
export function resolveHighlightlyTeam(ref: HlTeamRef | string | null | undefined): TeamCode | null {
  const name = teamName(ref)
  if (!name) return null
  return ALIAS_INDEX.get(normalizeTeamName(name)) ?? null
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Texto del estado, venga como cadena o como `{ description }`. */
export function stateLabel(state: HlMatchState | undefined): string | null {
  if (typeof state === 'string') return state.trim() || null
  const description = state?.description?.trim()
  return description ? description : null
}

/**
 * ¿Suena a partido acabado?
 *
 * Es INFORMATIVO, nunca decisorio: quien decide que un partido esta jugado es
 * `matches.status = 'played'`, que viene de football-data.org y esta verificado.
 * Si esta funcion se equivocara y aqui se usara como filtro, un vocabulario de
 * estado distinto al esperado dejaria la peña sin goleadores toda la temporada.
 */
export function looksFinished(state: HlMatchState | undefined): boolean {
  const label = stateLabel(state)
  if (!label) return false
  return /finish|finalizado|full.?time|\bft\b|ended|after.?(extra|penalt)/i.test(label)
}

// ---------------------------------------------------------------------------
// Emparejamiento
// ---------------------------------------------------------------------------

/** Lo minimo que hace falta de un partido NUESTRO para emparejarlo. */
export interface LocalMatch {
  /** `matches.id` de Supabase. */
  id: string
  homeCode: TeamCode
  awayCode: TeamCode
  /** `matches.kickoff_at`, en ISO. */
  kickoffAt: string
}

/** Partido de Highlightly ya traducido a nuestro vocabulario. */
export interface ResolvedApiMatch {
  /** Id de Highlightly. Es el que va a `/events/{id}` y `/lineups/{id}`. */
  apiId: string
  homeCode: TeamCode | null
  awayCode: TeamCode | null
  /** Nombres literales, para poder pegarlos en la tabla de alias si no casan. */
  homeName: string | null
  awayName: string | null
  day: string | null
  state: string | null
  raw: HlMatch
}

/** Traduce un partido de la API a nuestro vocabulario. No decide nada. */
export function resolveApiMatch(match: HlMatch): ResolvedApiMatch | null {
  const apiId = match.id === undefined || match.id === null ? null : String(match.id)
  if (!apiId) return null
  return {
    apiId,
    homeCode: resolveHighlightlyTeam(match.homeTeam),
    awayCode: resolveHighlightlyTeam(match.awayTeam),
    homeName: teamName(match.homeTeam),
    awayName: teamName(match.awayTeam),
    day: madridDate(match.date),
    state: stateLabel(match.state),
    raw: match,
  }
}

/** Por que no se pudo emparejar un partido nuestro. Va tal cual al informe. */
export interface LinkFailure {
  matchId: string
  pairing: string
  day: string | null
  reason: string
  /** Nombres literales que dio la API ese dia, para completar la tabla de alias. */
  apiTeamsThatDay: string[]
}

export interface LinkOutcome {
  linked: Array<{ local: LocalMatch; api: ResolvedApiMatch }>
  failures: LinkFailure[]
}

/**
 * Empareja nuestros partidos con los que ha devuelto la API, agrupados por dia.
 *
 * `apiMatchesByDay` es lo que se ha traido de `GET /matches?date=...`: una
 * entrada por dia consultado. El emparejador mira el dia del partido y sus dos
 * contiguos (ver cabecera) y exige que coincidan LOCAL Y VISITANTE, en ese orden.
 * No hay emparejamiento "por si acaso": o los tres datos cuadran, o falla.
 */
export function linkMatches(
  locals: LocalMatch[],
  apiMatchesByDay: Map<string, ResolvedApiMatch[]>,
): LinkOutcome {
  const linked: LinkOutcome['linked'] = []
  const failures: LinkFailure[] = []
  // Un partido de la API no puede alimentar a dos nuestros.
  const claimed = new Set<string>()

  for (const local of locals) {
    const pairing = `${local.homeCode}-${local.awayCode}`
    const day = madridDate(local.kickoffAt)
    if (!day) {
      failures.push({
        matchId: local.id,
        pairing,
        day: null,
        reason: `kickoff_at ilegible (${local.kickoffAt})`,
        apiTeamsThatDay: [],
      })
      continue
    }

    const days = neighbouringDays(day)
    const pool: ResolvedApiMatch[] = []
    for (const d of days) pool.push(...(apiMatchesByDay.get(d) ?? []))

    const hits = pool.filter(
      (candidate) =>
        !claimed.has(candidate.apiId) &&
        candidate.homeCode === local.homeCode &&
        candidate.awayCode === local.awayCode,
    )

    if (hits.length === 1) {
      claimed.add(hits[0].apiId)
      linked.push({ local, api: hits[0] })
      continue
    }

    // Nombres literales del dia, incluidos los que no supimos traducir: es la
    // informacion util para arreglar HIGHLIGHTLY_TEAM_ALIASES sin adivinar.
    const apiTeamsThatDay = [
      ...new Set(
        pool.flatMap((candidate) =>
          [candidate.homeName, candidate.awayName].filter((n): n is string => Boolean(n)),
        ),
      ),
    ].sort()

    failures.push({
      matchId: local.id,
      pairing,
      day,
      reason:
        hits.length === 0
          ? pool.length === 0
            ? 'la API no devolvio ningun partido ese dia ni en los contiguos'
            : 'ningun partido de la API ese dia casa con esos dos equipos (revisa HIGHLIGHTLY_TEAM_ALIASES)'
          : `${hits.length} partidos de la API casan con el mismo emparejamiento; ambiguo, no se toca`,
      apiTeamsThatDay,
    })
  }

  return { linked, failures }
}
