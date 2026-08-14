/**
 * Sincronizacion football-data.org -> Supabase.
 *
 * Lo que hace, en una frase: una sola peticion a la API, y con ella deja
 * `gameweeks` y `matches` de la liga igual que la realidad, sin tocar nada de lo
 * que la API no sabe.
 *
 * TRES INVARIANTES QUE NO SE NEGOCIAN
 *
 * 1. **Un `kickoff_at` pasado no se reescribe JAMAS.** Toda la RLS de pronosticos
 *    cuelga de esa hora: `predictions` de otro miembro solo son visibles cuando
 *    `matches.kickoff_at <= now()`. Si la API corrigiera a posteriori la hora de
 *    un partido ya empezado y la moviesemos hacia adelante, los pronosticos
 *    ajenos volverian a ocultarse... o peor, alguien podria pronosticar un
 *    partido que ya se jugo. Una vez sonado el pitido inicial, la hora esta
 *    sellada. La API solo manda sobre partidos que aun no han empezado.
 *
 * 2. **La ingesta no escribe `real_mvp` ni `real_scorers`.** El plan gratuito no
 *    da alineaciones ni goleadores. Esas dos columnas son territorio exclusivo
 *    del organizador desde /ajustes/admin, y por eso ni siquiera aparecen en el
 *    payload del upsert (PostgREST solo actualiza las columnas que le mandas).
 *
 * 3. **Es idempotente.** La clave es `matches.external_id` = `fd:<id de la API>`.
 *    Ejecutarla veinte veces seguidas deja exactamente el mismo estado.
 *
 * SOLO SERVIDOR: usa la service role key, que se salta RLS. Nunca importar esto
 * desde un Client Component.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SEASON } from '@/lib/laliga'
import type { MatchStatus, TeamCode } from '@/lib/types'
import { getCompetitionMatches, type CompetitionMatchesQuery } from './client'
import type { FdMatch, FdRateLimit, FdScoreLine, FdTeamRef } from './types'

// ---------------------------------------------------------------------------
// Equipos: de la API a nuestros TeamCode
// ---------------------------------------------------------------------------

/**
 * La `tla` de la API NO es nuestro `TeamCode`. Coinciden en muchos casos por pura
 * casualidad, pero no en los que importan: la API usa `ATL` para el Atletico
 * (nosotros `ATM`) y `FCB` para el Barcelona (nosotros `BAR`). Emparejar por
 * `tla` a secas produciria partidos con equipos equivocados en silencio, que es
 * la peor clase de bug.
 *
 * Resolucion, en este orden:
 *
 *   1. `TEAM_ID_OVERRIDES`, por id numerico de la API. Es la unica forma
 *      **estable** de identificar un equipo: el id no cambia nunca, el nombre si.
 *      Arranca VACIO a proposito (ver nota abajo).
 *   2. `TEAM_ALIASES`, por igualdad exacta del nombre normalizado contra `name`,
 *      `shortName` o `tla`.
 *
 * Si no cae en ninguna, el equipo es DESCONOCIDO: el partido se descarta, se
 * anota en `report.unknownTeams` con su id, su nombre y su tla, y la ingesta
 * **sigue**. Nunca revienta: un ascendido nuevo o un rebautizo no puede tumbar
 * la sincronizacion de los otros 19 equipos.
 */

/**
 * Vinculacion por id de la API. Es el emparejamiento BUENO: no depende de como
 * escriban el nombre del club ni de la `tla`.
 *
 * Ids leidos de `GET /v4/competitions/PD/teams` el 11 de agosto de 2026 con un
 * token real. Tres no coinciden con nuestros codigos y son justo los que un
 * emparejamiento por `tla` habria roto en silencio:
 *   ATL -> ATM (Atletico), FCB -> BAR (Barcelona), SAN -> RAC (Racing).
 *
 * Si un club cambia de id o entra uno nuevo, la ingesta lo reporta en
 * `unknownTeams` en vez de reventar; se anade aqui y listo.
 */
export const TEAM_ID_OVERRIDES: Record<number, TeamCode> = {
  77: 'ATH',   // Athletic Club
  78: 'ATM',   // Atletico de Madrid  (la API usa ATL)
  79: 'OSA',   // CA Osasuna
  80: 'ESP',   // RCD Espanyol
  81: 'BAR',   // FC Barcelona        (la API usa FCB)
  82: 'GET',   // Getafe CF
  84: 'MAL',   // Malaga CF
  86: 'RMA',   // Real Madrid CF
  87: 'RAY',   // Rayo Vallecano
  88: 'LEV',   // Levante UD
  90: 'BET',   // Real Betis
  92: 'RSO',   // Real Sociedad
  94: 'VIL',   // Villarreal CF
  95: 'VAL',   // Valencia CF
  263: 'ALA',  // Deportivo Alaves
  285: 'ELC',  // Elche CF
  558: 'CEL',  // RC Celta de Vigo
  559: 'SEV',  // Sevilla FC
  560: 'DEP',  // RC Deportivo de La Coruna
  5335: 'RAC', // Real Racing Club de Santander (la API usa SAN)
}

/**
 * Nombres candidatos por equipo, en forma normalizada (minusculas, sin acentos).
 *
 * Son las grafias con las que football-data.org suele publicar a estos clubes,
 * mas las variantes razonables. La comparacion es por IGUALDAD EXACTA, no por
 * "contiene": con subcadenas, `deportivo` casaria a la vez con el Depor y con el
 * Deportivo Alaves.
 */
const TEAM_ALIASES: Record<TeamCode, string[]> = {
  ALA: ['deportivo alaves', 'alaves', 'cd alaves', 'ala'],
  ATH: ['athletic club', 'athletic bilbao', 'athletic', 'ath'],
  ATM: ['club atletico de madrid', 'atletico de madrid', 'atletico madrid', 'atleti', 'atl', 'atm'],
  BAR: ['fc barcelona', 'barcelona', 'barca', 'fcb', 'bar'],
  BET: ['real betis balompie', 'real betis', 'betis', 'bet'],
  CEL: ['rc celta de vigo', 'celta de vigo', 'celta vigo', 'celta', 'cel'],
  DEP: ['rc deportivo de la coruna', 'deportivo de la coruna', 'deportivo la coruna', 'dep'],
  ELC: ['elche cf', 'elche', 'elc'],
  ESP: ['rcd espanyol de barcelona', 'rcd espanyol', 'espanyol', 'esp'],
  GET: ['getafe cf', 'getafe', 'get'],
  LEV: ['levante ud', 'levante', 'lev'],
  MAL: ['malaga cf', 'malaga', 'mal'],
  OSA: ['ca osasuna', 'osasuna', 'osa'],
  RAC: ['real racing club de santander', 'racing de santander', 'racing santander', 'racing', 'rac', 'san', 'santander'],
  RAY: ['rayo vallecano de madrid', 'rayo vallecano', 'rayo', 'ray'],
  RMA: ['real madrid cf', 'real madrid', 'rma'],
  RSO: ['real sociedad de futbol', 'real sociedad', 'rso'],
  SEV: ['sevilla fc', 'sevilla', 'sev'],
  VAL: ['valencia cf', 'valencia', 'val'],
  VIL: ['villarreal cf', 'villarreal', 'vil'],
}

/** Minusculas, sin diacriticos, sin puntuacion y con los espacios colapsados. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Indice alias -> codigo, construido una vez al importar el modulo. */
const ALIAS_INDEX: Map<string, TeamCode> = (() => {
  const index = new Map<string, TeamCode>()
  for (const [code, aliases] of Object.entries(TEAM_ALIASES) as [TeamCode, string[]][]) {
    for (const alias of aliases) {
      const key = normalizeName(alias)
      const previous = index.get(key)
      // Un alias repetido entre dos equipos emparejaria partidos mal: es un bug
      // de esta tabla y tiene que saltar en el primer import, no en produccion.
      if (previous && previous !== code) {
        throw new Error(
          `TEAM_ALIASES: el alias "${alias}" esta asignado a ${previous} y a ${code}.`,
        )
      }
      index.set(key, code)
    }
  }
  return index
})()

export interface UnknownTeam {
  id: number
  name: string | null
  tla: string | null
}

/** `null` si el equipo no esta en nuestra liga o no lo reconocemos. */
export function resolveTeamCode(team: FdTeamRef): TeamCode | null {
  const byId = TEAM_ID_OVERRIDES[team.id]
  if (byId) return byId

  for (const candidate of [team.name, team.shortName, team.tla]) {
    if (!candidate) continue
    const hit = ALIAS_INDEX.get(normalizeName(candidate))
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * Estado de la API -> nuestro `MatchStatus`.
 *
 * | football-data.org | nuestro   | por que                                            |
 * |-------------------|-----------|----------------------------------------------------|
 * | SCHEDULED         | `open`    | hay fecha, aun no hay hora firme                   |
 * | TIMED             | `open`    | hora confirmada, aun no ha empezado                |
 * | IN_PLAY           | `live`    | rodando                                            |
 * | PAUSED            | `live`    | descanso: para la pena sigue en juego              |
 * | FINISHED          | `played`  | pitido final con marcador                          |
 * | AWARDED           | `played`  | resultado por resolucion federativa                |
 * | SUSPENDED         | `locked`  | sellado y sin resultado: nadie puede ya pronosticar|
 * | POSTPONED         | `locked`  | idem; el organizador decide que hacer              |
 * | CANCELLED/CANCELED| `locked`  | idem; los puntos los anula el organizador          |
 *
 * Encima de la tabla va una correccion temporal: un partido que la API aun llame
 * SCHEDULED/TIMED pero cuya hora ya paso pasa a `locked`. Sin esto la UI seguiria
 * pintando "abierto" un partido que ya ha empezado durante los minutos que la API
 * tarda en refrescar.
 */
export function mapStatus(fd: FdMatch['status'], kickoffMs: number, nowMs: number): MatchStatus {
  switch (fd) {
    case 'IN_PLAY':
    case 'PAUSED':
      return 'live'
    case 'FINISHED':
    case 'AWARDED':
      return 'played'
    case 'SUSPENDED':
    case 'POSTPONED':
    case 'CANCELLED':
    case 'CANCELED':
      return 'locked'
    case 'SCHEDULED':
    case 'TIMED':
    default:
      return kickoffMs <= nowMs ? 'locked' : 'open'
  }
}

/**
 * Lee un marcador parcial aceptando las dos grafias.
 * v4 usa `home`/`away`; v2 usaba `homeTeam`/`awayTeam` y aun asoma en algun
 * ejemplo suelto de la documentacion.
 */
function readScoreLine(line: FdScoreLine | undefined): { home: number; away: number } | null {
  if (!line) return null
  const home = line.home ?? line.homeTeam
  const away = line.away ?? line.awayTeam
  if (typeof home !== 'number' || typeof away !== 'number') return null
  return { home, away }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

export interface SkippedMatch {
  externalId: string
  reason: string
}

export interface SyncReport {
  ok: boolean
  /** Temporada que ha devuelto la API (`filters.season`), p. ej. `"2026"`. */
  apiSeason: string | null
  /** Nuestra temporada esperada, de `laliga.ts`. */
  expectedSeason: string
  leagueId: string
  /** Partidos que ha devuelto la API. */
  fetched: number
  gameweeksUpserted: number
  matchesUpserted: number
  /**
   * Partidos sembrados por `seed.sql` (sin `external_id`) que esta pasada ha
   * reconocido por (jornada, local, visitante) y ha adoptado en vez de duplicar.
   * En la primera sincronizacion deberia valer 380; despues, 0.
   */
  adopted: number
  /** Partidos cuyo `kickoff_at` NO se toco por estar ya en el pasado. */
  kickoffsSealed: number
  /**
   * Partidos cuyo `kickoff_at` NO se toco porque lo fijo el organizador
   * (`kickoff_source = 'admin'`, migracion 0016). Se informa aparte de
   * `kickoffsSealed` para que se pueda ver en el informe del cron que una hora
   * corregida a mano sigue en pie -- y para notar si alguna se quedo ahi de por
   * vida por olvido.
   */
  kickoffsManual: number
  /**
   * Correcciones a mano que ESTA pasada ha devuelto a la API, porque el
   * proveedor ya coincide o porque acaba de publicar un cambio (0017).
   */
  kickoffsReleased: number
  /** Partidos a los que se les ha escrito marcador real en esta pasada. */
  resultsWritten: number
  skipped: SkippedMatch[]
  unknownTeams: UnknownTeam[]
  /** Los 20 codigos vistos con el id que la API les da. Para rellenar TEAM_ID_OVERRIDES. */
  resolvedTeams: Array<{ id: number; code: TeamCode; name: string | null }>
  warnings: string[]
  rateLimit: FdRateLimit
  durationMs: number
}

export interface SyncOptions {
  /** Solo una jornada. Sigue siendo 1 peticion; util para refrescar en vivo. */
  matchday?: number
  /** Ano de inicio de temporada. Por defecto, la que la API considere actual. */
  season?: number
  /**
   * Por defecto la ingesta ABORTA si la API sirve una temporada distinta a la de
   * `laliga.ts`. Escribir el calendario de la temporada equivocada encima de la
   * buena seria muy caro de deshacer.
   */
  allowSeasonMismatch?: boolean
  /** Liga destino. Si se omite, se usa `SYNC_LEAGUE_ID` o la unica liga que haya. */
  leagueId?: string
}

// ---------------------------------------------------------------------------
// Cliente Supabase con service role
// ---------------------------------------------------------------------------

/**
 * El cron no tiene sesion de usuario y las politicas de `matches`/`gameweeks`
 * solo dejan escribir al admin `authenticated`. Por eso aqui, y solo aqui, se usa
 * la service role key, que se salta RLS.
 *
 * NUNCA con prefijo `NEXT_PUBLIC_`: acabaria en el bundle del navegador y
 * cualquiera podria reescribir resultados.
 */
function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. La ingesta escribe ' +
        'en tablas cuyas politicas RLS solo admiten al admin, asi que necesita la service role key.',
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function resolveLeagueId(admin: SupabaseClient, explicit?: string): Promise<string> {
  const configured = explicit ?? process.env.SYNC_LEAGUE_ID
  if (configured) return configured

  const { data, error } = await admin.from('leagues').select('id, name').limit(2)
  if (error) throw new Error(`No se pudo leer leagues: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No hay ninguna liga en Supabase. Aplica supabase/seed.sql antes de sincronizar.')
  }
  if (data.length > 1) {
    throw new Error(
      'Hay mas de una liga y `matches.external_id` es unico global: configura SYNC_LEAGUE_ID ' +
        'para decir cual se alimenta de la API.',
    )
  }
  return data[0].id as string
}

/** Divide en trozos para no montar una query string kilometrica. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface ExistingMatch {
  id: string
  external_id: string
  kickoff_at: string
  status: MatchStatus
  real_home: number | null
  real_away: number | null
  /** 'admin' = la hora la fijo el organizador y aqui no se toca (0016). */
  kickoff_source: string | null
  /** Lo que decia la API en la pasada anterior (0017). null = ninguna aun. */
  kickoff_api_at: string | null
}

// ---------------------------------------------------------------------------
// Ingesta
// ---------------------------------------------------------------------------

export async function syncMatches(options: SyncOptions = {}): Promise<SyncReport> {
  const startedAt = Date.now()
  const warnings: string[] = []
  const skipped: SkippedMatch[] = []
  const unknownById = new Map<number, UnknownTeam>()
  const resolvedById = new Map<number, { id: number; code: TeamCode; name: string | null }>()

  const query: CompetitionMatchesQuery = {}
  if (options.matchday !== undefined) query.matchday = options.matchday
  if (options.season !== undefined) query.season = options.season

  // UNA sola peticion: con el plan gratuito (10/min) no hay margen para bucles.
  const { data: payload, meta } = await getCompetitionMatches(query)

  const apiSeason = payload.filters.season ?? null
  // `SEASON` es '2026-27'; la API responde con el ano de inicio, '2026'.
  const expectedStartYear = SEASON.split('-')[0]
  if (apiSeason && apiSeason !== expectedStartYear) {
    const message =
      `La API sirve la temporada ${apiSeason} y laliga.ts espera la ${SEASON}. ` +
      'Ingesta abortada para no pisar el calendario bueno con el de otra temporada.'
    if (!options.allowSeasonMismatch) throw new Error(message)
    warnings.push(message)
  }

  const admin = createAdminClient()
  const leagueId = await resolveLeagueId(admin, options.leagueId)
  const nowMs = Date.now()

  // ---- 1. Filtrado y traduccion de equipos -------------------------------

  interface Candidate {
    externalId: string
    matchday: number
    home: TeamCode
    away: TeamCode
    apiKickoffMs: number
    fdStatus: FdMatch['status']
    score: { home: number; away: number } | null
  }

  const candidates: Candidate[] = []

  for (const match of payload.matches) {
    const externalId = `fd:${match.id}`

    if (match.matchday === null || match.matchday === undefined) {
      skipped.push({ externalId, reason: 'sin jornada (matchday nulo)' })
      continue
    }

    const home = resolveTeamCode(match.homeTeam)
    const away = resolveTeamCode(match.awayTeam)

    for (const [ref, code] of [
      [match.homeTeam, home],
      [match.awayTeam, away],
    ] as const) {
      if (code) {
        resolvedById.set(ref.id, { id: ref.id, code, name: ref.name })
      } else {
        unknownById.set(ref.id, { id: ref.id, name: ref.name, tla: ref.tla })
      }
    }

    if (!home || !away) {
      // Equipo desconocido: se anota y se sigue. Nunca se aborta la ingesta.
      skipped.push({
        externalId,
        reason: `equipo sin mapear (${match.homeTeam.name ?? '?'} vs ${match.awayTeam.name ?? '?'})`,
      })
      continue
    }
    if (home === away) {
      skipped.push({ externalId, reason: `mismo equipo en los dos lados (${home})` })
      continue
    }

    const apiKickoffMs = Date.parse(match.utcDate)
    if (!Number.isFinite(apiKickoffMs)) {
      skipped.push({ externalId, reason: `utcDate ilegible (${match.utcDate})` })
      continue
    }

    candidates.push({
      externalId,
      matchday: match.matchday,
      home,
      away,
      apiKickoffMs,
      fdStatus: match.status,
      score: readScoreLine(match.score?.fullTime),
    })
  }

  // ---- 2. Jornadas -------------------------------------------------------

  const matchdays = [...new Set(candidates.map((c) => c.matchday))].sort((a, b) => a - b)

  const { data: storedGameweeks, error: gwReadError } = await admin
    .from('gameweeks')
    .select('id, number, opens_at')
    .eq('league_id', leagueId)
  if (gwReadError) throw new Error(`No se pudieron leer gameweeks: ${gwReadError.message}`)

  const gwByNumber = new Map<number, { id: string; opensAt: string }>(
    (storedGameweeks ?? []).map((g) => [g.number as number, { id: g.id as string, opensAt: g.opens_at as string }]),
  )

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const gameweekRows = matchdays.map((number) => {
    const firstKickoff = Math.min(
      ...candidates.filter((c) => c.matchday === number).map((c) => c.apiKickoffMs),
    )
    const stored = gwByNumber.get(number)
    // Misma regla que el seed: la jornada abre una semana antes de su primer
    // partido. Una jornada que ya abrio no se vuelve a mover: reabrirla dejaria
    // la UI diciendo que se puede pronosticar algo que ya empezo.
    const opensAt =
      stored && Date.parse(stored.opensAt) <= nowMs
        ? stored.opensAt
        : new Date(firstKickoff - WEEK_MS).toISOString()
    return { league_id: leagueId, number, opens_at: opensAt }
  })

  let gameweeksUpserted = 0
  if (gameweekRows.length > 0) {
    const { data: upsertedGw, error } = await admin
      .from('gameweeks')
      .upsert(gameweekRows, { onConflict: 'league_id,number' })
      .select('id, number')
    if (error) throw new Error(`Upsert de gameweeks fallido: ${error.message}`)
    gameweeksUpserted = upsertedGw?.length ?? 0
    for (const row of upsertedGw ?? []) {
      gwByNumber.set(row.number as number, {
        id: row.id as string,
        opensAt: gameweekRows.find((g) => g.number === row.number)!.opens_at,
      })
    }
  }

  // ---- 3. Estado actual de los partidos ----------------------------------

  const existingByExternalId = new Map<string, ExistingMatch>()
  for (const ids of chunk(candidates.map((c) => c.externalId), 100)) {
    const { data, error } = await admin
      .from('matches')
      .select('id, external_id, kickoff_at, status, real_home, real_away, kickoff_source, kickoff_api_at')
      .in('external_id', ids)
    if (error) {
      // 42703 / PGRST204 = la columna no existe todavia. Mensaje explicito en vez
      // de un error de PostgREST que no dice que hacer.
      if (/external_id/i.test(error.message)) {
        throw new Error(
          'Falta la columna `matches.external_id`. Aplica la migracion pendiente ' +
            '(ver docs/INGESTA.md): alter table public.matches add column external_id text unique.',
        )
      }
      throw new Error(`No se pudieron leer matches: ${error.message}`)
    }
    for (const row of (data ?? []) as ExistingMatch[]) {
      existingByExternalId.set(row.external_id, row)
    }
  }

  // ADOPCION DE PARTIDOS SEMBRADOS.
  // `supabase/seed.sql` mete los 380 partidos del calendario de laliga.ts SIN
  // `external_id`. Si la primera sincronizacion no los reconociera, el upsert por
  // external_id no encontraria conflicto y la liga acabaria con 760 partidos y
  // los pronosticos colgando de los que ya no se usan. Asi que antes de escribir,
  // cada partido de la API busca su gemelo sembrado por (jornada, local, visitante)
  // y se queda con su fila.
  const orphansByPairing = new Map<string, ExistingMatch>()
  const gameweekIds = [...gwByNumber.values()].map((g) => g.id)
  const pairingKey = (gameweekId: string, home: TeamCode, away: TeamCode) =>
    `${gameweekId}|${home}|${away}`

  if (gameweekIds.length > 0) {
    const { data, error } = await admin
      .from('matches')
      .select(
        'id, external_id, gameweek_id, home_code, away_code, kickoff_at, status, real_home, real_away, kickoff_source, kickoff_api_at',
      )
      .in('gameweek_id', gameweekIds)
      .is('external_id', null)
    if (error) throw new Error(`No se pudieron leer los partidos sembrados: ${error.message}`)
    for (const row of data ?? []) {
      orphansByPairing.set(
        pairingKey(row.gameweek_id as string, row.home_code as TeamCode, row.away_code as TeamCode),
        row as ExistingMatch,
      )
    }
  }

  // ---- 4. Filas finales --------------------------------------------------

  let kickoffsSealed = 0
  let kickoffsManual = 0
  let resultsWritten = 0

  /**
   * Correcciones a mano que esta pasada devuelve a la API. Se aplican DESPUES
   * del upsert y una a una, porque llevan un compare-and-swap sobre la hora que
   * un upsert masivo no puede expresar.
   */
  const releases: Array<{ id: string; kickoffAt: string }> = []

  let adopted = 0

  interface MatchRow {
    /** Solo en filas que ya existen: fuerza el upsert a caer sobre esa fila. */
    id?: string
    external_id: string
    gameweek_id: string
    home_code: TeamCode
    away_code: TeamCode
    kickoff_at: string
    /**
     * Siempre false: la hora que da la API es la programada por LaLiga, no una
     * estimacion nuestra. Este es el mecanismo por el que los horarios dejan de
     * ser provisionales: en cuanto la ingesta pasa, la etiqueta "Por confirmar"
     * desaparece sola de la interfaz.
     */
    kickoff_provisional: boolean
    /**
     * Lo que dice la API AHORA, se este usando o no (0017). Se escribe siempre,
     * tambien cuando manda una correccion del organizador: es la foto contra la
     * que la pasada siguiente decide si el proveedor se ha movido.
     */
    kickoff_api_at: string
    status: MatchStatus
    real_home: number | null
    real_away: number | null
    position: number
  }

  const rowsByMatchday = new Map<number, MatchRow[]>()

  for (const candidate of candidates) {
    const gameweek = gwByNumber.get(candidate.matchday)
    if (!gameweek) {
      skipped.push({ externalId: candidate.externalId, reason: `jornada ${candidate.matchday} sin fila` })
      continue
    }

    let stored = existingByExternalId.get(candidate.externalId)
    if (!stored) {
      const key = pairingKey(gameweek.id, candidate.home, candidate.away)
      const orphan = orphansByPairing.get(key)
      if (orphan) {
        // Se lo queda: se borra del mapa para que dos partidos de la API no
        // puedan reclamar la misma fila sembrada.
        orphansByPairing.delete(key)
        stored = orphan
        adopted += 1
      }
    }
    const storedKickoffMs = stored ? Date.parse(stored.kickoff_at) : Number.NaN

    // INVARIANTE 1: hora sellada. Si el partido ya empezo segun lo que hay en la
    // base, esa hora manda sobre la de la API pase lo que pase.
    const sealed = stored !== undefined && Number.isFinite(storedKickoffMs) && storedKickoffMs <= nowMs
    if (sealed) kickoffsSealed += 1

    // INVARIANTE 1-bis (migracion 0016): hora fijada por el organizador.
    //
    // Cuando LaLiga aplaza un partido, football-data.org tarda en enterarse: el
    // 14/08/2026 aplazaron Celta-Osasuna y la API seguia dando la hora vieja
    // horas despues, incluso forzando una pasada a mano. Como el estado que se
    // pinta, el cierre del pronostico y la RLS cuelgan los tres de `kickoff_at`,
    // esa hora vieja deja a la peña sin poder pronosticar un partido que no se
    // ha jugado Y destapa los pronosticos de todos.
    //
    // Va DESPUES del sellado y no lo pisa: un partido ya empezado no se mueve ni
    // a mano. Moverle la hora hacia adelante volveria a esconder pronosticos que
    // la peña ya tiene vistos.
    //
    // CUANDO SE SUELTA EL MANDO SOLO (migracion 0017)
    // Una correccion a mano es un apaño mientras el proveedor se pone al dia, no
    // una decision para toda la temporada. Se devuelve el mando a la API en
    // cuanto pasa cualquiera de estas dos cosas:
    //
    //   a) la API ya coincide con la hora corregida: no queda nada que proteger;
    //   b) la API ha CAMBIADO respecto a la pasada anterior: acaba de publicar
    //      algo, y eso es mas de fiar que una correccion de hace dias.
    //
    // (b) es la importante y la que no se ve a simple vista: si el organizador
    // se equivoco de fecha, con solo (a) su hora incorrecta seguiria por encima
    // de la oficial para siempre, y la peña jugaria contra una hora inventada.
    // Con (b) basta con que LaLiga publique lo que sea para que mande la API.
    //
    // Con `kickoff_api_at` a null (fila anterior a la 0017, aun sin pasada) (b)
    // no se puede evaluar y solo actua (a): sin foto con la que comparar, no
    // soltar el mando es lo prudente.
    const apiAgrees = Number.isFinite(storedKickoffMs) && candidate.apiKickoffMs === storedKickoffMs
    const lastApiMs = stored?.kickoff_api_at ? Date.parse(stored.kickoff_api_at) : Number.NaN
    const apiMoved = Number.isFinite(lastApiMs) && lastApiMs !== candidate.apiKickoffMs

    const wasManual =
      !sealed && stored?.kickoff_source === 'admin' && Number.isFinite(storedKickoffMs)
    const release = wasManual && (apiAgrees || apiMoved)
    if (release) {
      releases.push({ id: stored!.id, kickoffAt: stored!.kickoff_at })
    }

    const manual = wasManual && !release
    if (manual) kickoffsManual += 1

    const kickoffMs = sealed || manual ? storedKickoffMs : candidate.apiKickoffMs

    let status = mapStatus(candidate.fdStatus, kickoffMs, nowMs)
    let realHome = stored?.real_home ?? null
    let realAway = stored?.real_away ?? null

    if (candidate.score) {
      if (realHome !== candidate.score.home || realAway !== candidate.score.away) resultsWritten += 1
      realHome = candidate.score.home
      realAway = candidate.score.away
    }

    // `matches_result_complete` exige marcador cuando el estado es 'played'.
    // Si la API dice FINISHED pero no manda marcador, no forzamos el estado.
    if (status === 'played' && (realHome === null || realAway === null)) {
      warnings.push(`${candidate.externalId}: FINISHED sin marcador; se deja en 'locked'.`)
      status = 'locked'
    }
    // Un resultado ya guardado no se pierde porque la API se despiste.
    if (stored?.status === 'played' && status !== 'played' && stored.real_home !== null) {
      status = 'played'
    }

    const list = rowsByMatchday.get(candidate.matchday) ?? []
    list.push({
      id: stored?.id,
      external_id: candidate.externalId,
      gameweek_id: gameweek.id,
      home_code: candidate.home,
      away_code: candidate.away,
      kickoff_at: new Date(kickoffMs).toISOString(),
      kickoff_provisional: false,
      kickoff_api_at: new Date(candidate.apiKickoffMs).toISOString(),
      status,
      real_home: realHome,
      real_away: realAway,
      position: 0, // se asigna abajo, cuando la jornada esta completa
    })
    rowsByMatchday.set(candidate.matchday, list)
  }

  // `position` ordena la lista de la jornada sin depender de la hora en la UI.
  // Se calcula sobre el kickoff EFECTIVO (el sellado si lo hay), asi que un
  // partido ya jugado nunca cambia de sitio.
  const rows: MatchRow[] = []
  for (const list of rowsByMatchday.values()) {
    list
      .sort(
        (a, b) =>
          Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at) ||
          a.external_id.localeCompare(b.external_id),
      )
      .forEach((row, index) => {
        row.position = index + 1
        rows.push(row)
      })
  }

  // ---- 5. Upsert ---------------------------------------------------------
  // Dos lotes, porque PostgREST exige que todas las filas de un insert masivo
  // lleven EXACTAMENTE las mismas claves:
  //   - las que ya existen van con `id` y conflicto por clave primaria;
  //   - las nuevas van sin `id` (lo genera el default) y conflicto por external_id.
  // En los dos, `real_mvp` y `real_scorers` estan ausentes a proposito: PostgREST
  // solo actualiza las columnas que recibe, asi que lo que metio el organizador
  // sobrevive a cada pasada del cron (INVARIANTE 2).

  const knownRows = rows.filter((r) => r.id !== undefined)
  const newRows = rows
    .filter((r) => r.id === undefined)
    .map((r) => ({
      external_id: r.external_id,
      gameweek_id: r.gameweek_id,
      home_code: r.home_code,
      away_code: r.away_code,
      kickoff_at: r.kickoff_at,
      kickoff_api_at: r.kickoff_api_at,
      status: r.status,
      real_home: r.real_home,
      real_away: r.real_away,
      position: r.position,
    }))

  const missingColumn = (message: string) =>
    new Error(
      'Falta la columna `matches.external_id` o su indice unico. Aplica la migracion pendiente ' +
        `(ver docs/INGESTA.md). Detalle de PostgREST: ${message}`,
    )

  let matchesUpserted = 0

  for (const batch of chunk(knownRows, 200)) {
    const { data, error } = await admin.from('matches').upsert(batch, { onConflict: 'id' }).select('id')
    if (error) {
      if (/external_id/i.test(error.message)) throw missingColumn(error.message)
      throw new Error(`Upsert de matches existentes fallido: ${error.message}`)
    }
    matchesUpserted += data?.length ?? 0
  }

  for (const batch of chunk(newRows, 200)) {
    const { data, error } = await admin
      .from('matches')
      .upsert(batch, { onConflict: 'external_id' })
      .select('id')
    if (error) {
      if (/external_id/i.test(error.message)) throw missingColumn(error.message)
      throw new Error(`Upsert de matches nuevos fallido: ${error.message}`)
    }
    matchesUpserted += data?.length ?? 0
  }

  // ---- 6. Soltar el mando de las horas puestas a mano (0017) --------------
  // Va DESPUES del upsert, y el upsert ya ha hecho la mitad del trabajo: para
  // una fila que se suelta, `manual` valia false, asi que la hora escrita es ya
  // la oficial de la API. Aqui solo queda mover `kickoff_source` a 'api'.
  //
  // Una por una y con compare-and-swap sobre `kickoff_at`, no en lote: entre que
  // esta pasada leyo y escribe cabe justo el momento en que el organizador
  // guarda OTRA correccion. Si la hora ya no es la que vimos, la fila cambio
  // debajo y no se toca; el `eq('kickoff_source', 'admin')` solo no bastaria,
  // porque una correccion nueva tambien es 'admin'.
  let kickoffsReleased = 0
  for (const item of releases) {
    const official = rows.find((r) => r.id === item.id)
    if (!official) continue
    const { data, error } = await admin
      .from('matches')
      .update({ kickoff_source: 'api' })
      .eq('id', item.id)
      .eq('kickoff_source', 'admin')
      // Se compara contra la hora que ACABA de escribir el upsert, no contra la
      // que habia antes: para una fila soltada el upsert ya puso la oficial, y
      // comparar con la vieja no casaria nunca. Si aqui no casa es que alguien
      // ha guardado otra correccion en el ultimo instante, y entonces se
      // respeta y no se suelta nada.
      .eq('kickoff_at', official.kickoff_at)
      .select('id')
    if (error) {
      warnings.push(`No se pudo devolver a la API el horario de ${item.id}: ${error.message}`)
      continue
    }
    if (data && data.length > 0) kickoffsReleased += 1
  }

  if (kickoffsReleased > 0) {
    warnings.push(
      `${kickoffsReleased} horario(s) corregido(s) a mano vuelven a seguir a la API: el proveedor ` +
        'ya publica ese partido.',
    )
  }

  if (orphansByPairing.size > 0) {
    warnings.push(
      `${orphansByPairing.size} partido(s) sembrado(s) sin equivalente en la API. Se dejan como ` +
        'estan: borrarlos se llevaria por delante los pronosticos asociados.',
    )
  }

  if (unknownById.size > 0) {
    warnings.push(
      `${unknownById.size} equipo(s) sin mapear. Anadelos a TEAM_ID_OVERRIDES en ` +
        'src/lib/football-data/ingest.ts con el id que aparece en `unknownTeams`.',
    )
  }

  return {
    ok: true,
    apiSeason,
    expectedSeason: SEASON,
    leagueId,
    fetched: payload.matches.length,
    gameweeksUpserted,
    matchesUpserted,
    adopted,
    kickoffsSealed,
    kickoffsManual,
    kickoffsReleased,
    resultsWritten,
    skipped,
    unknownTeams: [...unknownById.values()],
    resolvedTeams: [...resolvedById.values()].sort((a, b) => a.code.localeCompare(b.code)),
    warnings,
    rateLimit: meta.rateLimit,
    durationMs: Date.now() - startedAt,
  }
}
