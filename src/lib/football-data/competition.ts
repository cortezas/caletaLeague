/**
 * Sincronizacion de la COMPETICION football-data.org -> Supabase.
 *
 * Dos endpoints y dos tablas (migracion 0015):
 *   `GET /v4/competitions/PD/standings`      -> `public.competition_standings`
 *   `GET /v4/competitions/PD/scorers?limit=` -> `public.competition_scorers`
 *
 * Son 2 peticiones por pasada. La cuota del plan gratuito es de 10 por MINUTO
 * (no por dia, esa es la de Highlightly), asi que sumadas a las 2 que ya gastan
 * partidos y plantillas van 4 de 10. No hay problema de presupuesto aqui.
 *
 * CUATRO INVARIANTES QUE NO SE NEGOCIAN
 *
 * 1. **Los equipos se emparejan SOLO por id** (`TEAM_ID_OVERRIDES` de
 *    `ingest.ts`, que tiene los 20). No por nombre y sobre todo NO por `tla`, y
 *    esto no es purismo: hoy mismo el endpoint de clasificacion devuelve la
 *    tabla final de 2025/26, donde esta el RCD Mallorca (id 89) con `tla: "MAL"`.
 *    Nuestro `MAL` es el Malaga CF (id 84). Emparejar por `tla`, que es lo que
 *    hace `resolveTeamCode` como ultimo recurso, meteria los 42 puntos del
 *    Mallorca en la fila del Malaga sin decir nada. Un equipo que no case por id
 *    se anota en `unknownTeams` y se salta: NO se adivina.
 *
 * 2. **Es una foto, no un historico.** Cada pasada deja las tablas exactamente
 *    igual que la respuesta de la API. La sustitucion se hace con upsert +
 *    borrado de lo que sobra, y NO con "borrar todo y volver a insertar": entre
 *    el delete y el insert cabe la peticion de alguien, y ese alguien veria la
 *    clasificacion vacia. Con upsert primero, la tabla nunca pasa por el vacio.
 *
 * 3. **Una lista de goleadores vacia NO es un fallo.** Con la temporada sin
 *    empezar, `/scorers` devuelve `count: 0` y `scorers: []` (verificado el
 *    13/08/2026 con el token real). El paso tiene que terminar bien y dejar la
 *    tabla vacia. Cualquier otra cosa dejaria el informe del cron en rojo todos
 *    los dias hasta la primera jornada.
 *
 * 4. **Nunca revienta.** Devuelve siempre un informe; los fallos van en `error`.
 *    Es un paso SUBORDINADO: que la clasificacion no se pueda traer no puede
 *    tumbar la sincronizacion de partidos, que es la que hace falta para jugar.
 *
 * SOLO SERVIDOR: usa la service role key, que se salta RLS (en las dos tablas
 * `authenticated` solo tiene select). Nunca importar esto desde un Client
 * Component.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SEASON, TEAMS, TEAM_CODES } from '@/lib/laliga'
import type { TeamCode } from '@/lib/types'
import { COMPETITION_CODE, FootballDataError } from './client'
import { TEAM_ID_OVERRIDES, type UnknownTeam } from './ingest'
import type { FdCompetitionRef, FdRateLimit, FdTeamRef } from './types'

// ---------------------------------------------------------------------------
// Tipos de la respuesta (verificados contra la API real el 13/08/2026)
// ---------------------------------------------------------------------------

/** Una fila de la tabla de clasificacion. */
export interface FdStandingRow {
  position: number
  team: FdTeamRef
  playedGames: number
  /**
   * Racha, como cadena separada por comas: `"W,D,L,W,W"`.
   *
   * **Hoy llega `null`**: la temporada 2026/27 no ha empezado y la API no
   * publica racha (comprobado el 13/08/2026). No es un caso raro que haya que
   * tolerar de milagro, es el estado normal de las proximas semanas.
   */
  form: string | null
  won: number
  draw: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
}

export interface FdStandingsGroup {
  stage: string
  /** `TOTAL` es la tabla general. `HOME` y `AWAY` son las de local y visitante. */
  type: 'TOTAL' | 'HOME' | 'AWAY' | string
  group: string | null
  table: FdStandingRow[]
}

/** Respuesta de `GET /v4/competitions/{code}/standings`. */
export interface FdStandingsResponse {
  filters: { season?: string }
  competition: FdCompetitionRef
  season: {
    id: number
    startDate: string
    endDate: string
    /** Jornada en curso. Vale 1 mientras no se juegue nada. */
    currentMatchday: number | null
    winner: unknown
  }
  standings: FdStandingsGroup[]
}

export interface FdScorer {
  player: { id: number; name: string | null } | null
  team: FdTeamRef | null
  playedMatches?: number | null
  goals: number | null
  /** La API lo da o no lo da. `null` NO es cero. */
  assists?: number | null
  penalties?: number | null
}

/** Respuesta de `GET /v4/competitions/{code}/scorers`. */
export interface FdScorersResponse {
  count: number
  filters: { season?: string; limit?: number }
  competition: FdCompetitionRef
  scorers: FdScorer[]
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

export interface CompetitionSyncReport {
  ok: boolean
  /** Mensaje cuando `ok` es false. Los otros pasos del cron no se enteran. */
  error?: string
  /** `true` si el fallo es transitorio (429, 5xx, red) y merece reintento. */
  retryable?: boolean
  /** Temporada que ha devuelto la API (`filters.season`), p. ej. `"2026"`. */
  apiSeason: string | null
  expectedSeason: string
  /** Filas de clasificacion que ha devuelto la API. Deberian ser 20. */
  standingsFetched: number
  /** Filas escritas en `competition_standings`. */
  standingsWritten: number
  /** Filas retiradas por no estar ya en la foto nueva. */
  standingsRemoved: number
  /** Equipos con racha (`form` no vacio). Hoy son 0: la API no la da todavia. */
  standingsWithForm: number
  /** Goleadores que ha devuelto la API. **0 es normal** hasta la primera jornada. */
  scorersFetched: number
  scorersWritten: number
  scorersRemoved: number
  /** Goleadores guardados sin equipo porque su club no casa con ningun TeamCode. */
  scorersWithoutTeam: number
  /**
   * `true` cuando la tabla que sirve la API es todavia la FINAL de la temporada
   * anterior: la nueva no ha empezado (`currentMatchday <= 1`) pero las filas
   * traen partidos jugados. Es informativo, no un error: la API se corrige sola
   * en cuanto ruede el balon. La pantalla puede usarlo para etiquetar la tabla.
   */
  looksPreviousSeason: boolean
  /** Equipos de la API que no casan con ninguno de nuestros 20 ids. */
  unknownTeams: UnknownTeam[]
  warnings: string[]
  rateLimit: FdRateLimit
  durationMs: number
}

export interface CompetitionSyncOptions {
  /** Cuantos goleadores pedir. Por defecto 30. */
  scorersLimit?: number
  /** Ano de inicio de temporada. Por defecto, la que la API considere actual. */
  season?: number
}

const DEFAULT_SCORERS_LIMIT = 30

const EMPTY_RATE_LIMIT: FdRateLimit = { availableMinute: null, resetSeconds: null }

// ---------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.football-data.org/v4'

/**
 * No sale de `client.ts` porque su `fdFetch` es privado y ese fichero pertenece
 * a otro lote; es el mismo motivo por el que `squads.ts` tiene el suyo. Comparte
 * con el las dos cosas que importan: la cabecera `X-Auth-Token` (nunca en la
 * query string, acabaria en los logs del proxy) y el tipo de error, para que
 * quien llame no tenga que distinguir dos familias.
 */
async function fdGet<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  timeoutMs = 15_000,
): Promise<{ data: T; rateLimit: FdRateLimit }> {
  // El token se lee en cada llamada, no al importar el modulo: asi un despliegue
  // que anade la variable no necesita reiniciar el proceso.
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token) {
    // `Error` pelado y no `FootballDataError` a proposito: esta ultima marca como
    // reintentable todo lo que no llego a la red, y un token que falta no se
    // arregla reintentando.
    throw new Error(
      'Falta FOOTBALL_DATA_TOKEN. La clasificacion y los goleadores salen de ' +
        'football-data.org; sin token esas dos pantallas se quedan vacias. El resto de la ' +
        'app sigue funcionando igual.',
    )
  }

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      // Datos en vivo: la ingesta jamas debe leer de una cache intermedia.
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new FootballDataError(`No se pudo contactar con football-data.org: ${reason}`, 0)
  }

  const toInt = (raw: string | null) => {
    if (raw === null) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  }
  const rateLimit: FdRateLimit = {
    availableMinute: toInt(response.headers.get('X-Requests-Available-Minute')),
    resetSeconds: toInt(response.headers.get('X-RequestCounter-Reset')),
  }

  if (!response.ok) {
    let message = response.statusText
    let errorCode: number | null = null
    try {
      const body = (await response.json()) as { message?: string; errorCode?: number }
      message = body.message ?? message
      errorCode = body.errorCode ?? null
    } catch {
      /* ante un 502 del CDN el cuerpo es HTML: nos quedamos con el codigo */
    }
    const hint =
      response.status === 429
        ? ' El plan gratuito da 10 peticiones/minuto.'
        : response.status === 403
          ? ' Ese recurso o ese filtro no entran en el plan gratuito.'
          : ''
    throw new FootballDataError(
      `football-data.org ${response.status}: ${message}.${hint}`,
      response.status,
      errorCode,
      rateLimit,
    )
  }

  return { data: (await response.json()) as T, rateLimit }
}

// ---------------------------------------------------------------------------
// Traduccion
// ---------------------------------------------------------------------------

/**
 * Equipo de la API -> nuestro `TeamCode`, **solo por id**.
 *
 * A diferencia de `resolveTeamCode` (que despues del id prueba nombre, nombre
 * corto y `tla`), aqui no hay segundo intento. Ver la INVARIANTE 1 de la
 * cabecera: el Mallorca de la tabla de 2025/26 lleva `tla: "MAL"` y se colaria
 * como Malaga CF. En partidos ese riesgo no existe igual porque un equipo mal
 * emparejado se nota (aparece jugando donde no debe); en una clasificacion pasa
 * inadvertido para siempre.
 */
function resolveTeamById(team: FdTeamRef | null | undefined): TeamCode | null {
  if (!team || typeof team.id !== 'number') return null
  return TEAM_ID_OVERRIDES[team.id] ?? null
}

/**
 * `"W,D,L,W,W"` -> `['W','D','L','W','W']`.
 *
 * Tolera `null` (lo que manda la API hoy), cadena vacia, espacios sueltos y
 * minusculas. Cualquier letra que no sea W, D o L se descarta en vez de
 * guardarse: la restriccion `competition_standings_form_values` de la 0015 la
 * rechazaria y tumbaria el upsert de los otros 19 equipos.
 *
 * EL ORDEN SE RESPETA TAL CUAL LO MANDA LA API. No se invierte ni se recorta:
 * hoy `form` es `null` y no hay forma de comprobar si el primero es el partido
 * mas reciente o el mas antiguo, asi que inventarse una reordenacion seria
 * exactamente eso, inventarsela.
 */
export function parseForm(raw: unknown): Array<'W' | 'D' | 'L'> {
  if (typeof raw !== 'string') return []
  const out: Array<'W' | 'D' | 'L'> = []
  for (const piece of raw.split(',')) {
    const letter = piece.trim().toUpperCase()
    if (letter === 'W' || letter === 'D' || letter === 'L') out.push(letter)
  }
  return out
}

/** Entero de la API, o `fallback` si viene lo que sea menos un numero usable. */
function toInt(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  return fallback
}

/** Como `toInt`, pero "no hay dato" es `null` y NO cero. */
function toIntOrNull(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  return null
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/**
 * Las dos tablas de 0015 solo dan `select` a `authenticated`; el cron no tiene
 * sesion y ademas tiene que escribir. De ahi la service role key, que se salta
 * RLS. NUNCA con prefijo `NEXT_PUBLIC_`: acabaria en el bundle del navegador.
 */
function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. La ingesta escribe en ' +
        'competition_standings y competition_scorers, donde `authenticated` solo puede leer, ' +
        'asi que necesita la service role key.',
    )
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Las tablas las crea la 0015. Sin ellas, un mensaje que diga que hacer. */
function isMissingTable(message: string): boolean {
  return (
    /competition_(standings|scorers)/i.test(message) &&
    /(does not exist|schema cache|no existe)/i.test(message)
  )
}

function missingTableError(message: string): Error {
  return new Error(
    'Faltan las tablas `public.competition_standings` / `public.competition_scorers`. Aplica ' +
      `la migracion supabase/migrations/0015_competition.sql. Detalle de PostgREST: ${message}`,
  )
}

interface StandingRow {
  team_code: TeamCode
  position: number
  points: number
  played_games: number
  goals_for: number
  goals_against: number
  form: string[]
  updated_at: string
}

interface ScorerRow {
  rank: number
  player_name: string
  team_code: TeamCode | null
  goals: number
  assists: number | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// Ingesta
// ---------------------------------------------------------------------------

export async function syncCompetition(
  options: CompetitionSyncOptions = {},
): Promise<CompetitionSyncReport> {
  const startedAt = Date.now()
  const report: CompetitionSyncReport = {
    ok: false,
    apiSeason: null,
    expectedSeason: SEASON,
    standingsFetched: 0,
    standingsWritten: 0,
    standingsRemoved: 0,
    standingsWithForm: 0,
    scorersFetched: 0,
    scorersWritten: 0,
    scorersRemoved: 0,
    scorersWithoutTeam: 0,
    looksPreviousSeason: false,
    unknownTeams: [],
    warnings: [],
    rateLimit: EMPTY_RATE_LIMIT,
    durationMs: 0,
  }

  // Todas las filas de una misma foto comparten instante. Asi `max(updated_at)`
  // que lee la capa de datos significa "cuando se trajo esta tabla" y no "cuando
  // se toco la ultima fila", que serian dos cosas distintas.
  const fetchedAt = new Date().toISOString()
  const unknownById = new Map<number, UnknownTeam>()

  try {
    const admin = createAdminClient()

    // ---- 1. Clasificacion ---------------------------------------------------

    const { data: standingsPayload, rateLimit: standingsRate } = await fdGet<FdStandingsResponse>(
      `/competitions/${COMPETITION_CODE}/standings`,
      { season: options.season },
    )
    report.rateLimit = standingsRate
    report.apiSeason = standingsPayload.filters?.season ?? null

    // A DIFERENCIA de `syncMatches` y `syncSquads`, un desajuste de temporada
    // aqui NO aborta: solo avisa. Esas dos escriben el calendario y las
    // plantillas, y meter las del ano que viene encima de las de este seria muy
    // caro de deshacer. Esto es una foto que se reemplaza sola en la siguiente
    // pasada: abortar solo conseguiria dejar la pantalla vacia.
    const expectedStartYear = SEASON.split('-')[0]
    if (report.apiSeason && report.apiSeason !== expectedStartYear) {
      report.warnings.push(
        `La API sirve la clasificacion de la temporada ${report.apiSeason} y laliga.ts espera la ` +
          `${SEASON}. Se guarda igual (es una foto que se reemplaza en cada pasada), pero la ` +
          'pantalla estara mostrando otra temporada.',
      )
    }

    const total = (standingsPayload.standings ?? []).find((group) => group.type === 'TOTAL')
    if (!total) {
      report.warnings.push(
        'La respuesta de /standings no trae ningun grupo con type=TOTAL. No se toca la tabla ' +
          'guardada: dejarla vacia seria peor que servir la de la pasada anterior.',
      )
    }

    const table = total?.table ?? []
    report.standingsFetched = table.length

    // La API sigue sirviendo la tabla FINAL de la temporada anterior mientras la
    // nueva no arranca: `currentMatchday` vale 1 y sin embargo las filas traen 38
    // partidos jugados. No es un error y se guarda igual (se corrige sola en
    // cuanto ruede el balon), pero el informe tiene que decirlo.
    const currentMatchday = standingsPayload.season?.currentMatchday ?? null

    // COMO SE DISTINGUE LA TABLA VIEJA DE LA NUEVA
    //
    // La primera version preguntaba "hay algun equipo con partidos jugados y
    // currentMatchday <= 1". Eso funciono hasta que empezo la liga, y entonces
    // se volvio en contra: el 15/08/2026 se jugaron cuatro partidos de la
    // jornada 1, la API siguio diciendo `currentMatchday: 1` (la jornada no
    // habia terminado) y esos cuatro resultados hicieron que la condicion se
    // cumpliera. Resultado: la pestaña LaLiga sembrando ceros durante todo el
    // fin de semana con la tabla buena delante.
    //
    // La señal correcta es una imposibilidad aritmetica: NADIE puede haber
    // jugado mas partidos que jornadas van disputadas. Con la tabla del año
    // pasado son 38 contra 1 y salta; dentro de la jornada 1 es 1 contra 1 y no
    // salta. No hay zona gris.
    const impossiblePlayed =
      currentMatchday !== null &&
      table.some((row) => toInt(row.playedGames, 0) > currentMatchday)

    // Señal de respaldo para cuando la API no manda `currentMatchday`. Se exigen
    // TRES porque cada verano suben y bajan tres: uno o dos equipos sin mapear
    // son un rebautizo, y ese caso ya se trata fila a fila mas abajo sin tirar
    // la tabla entera.
    const outsiders = table.filter((row) => resolveTeamById(row.team) === null).length

    report.looksPreviousSeason = impossiblePlayed || outsiders >= 3

    const standingRows: StandingRow[] = []
    const seenCodes = new Set<TeamCode>()

    // La tabla de la temporada ANTERIOR no se guarda.
    //
    // La API se contradice: dice `filters.season: "2026"` y `currentMatchday: 1`,
    // pero sirve filas con 38 partidos jugados, y entre ellas Girona y Real
    // Oviedo, que descendieron y no juegan la 2026/27. Guardarla significaria
    // enseñar en la pestaña "LaLiga" una tabla con tres equipos que no estan en
    // la competicion, y ninguno de los tres ascendidos.
    //
    // En su lugar se siembran los 20 equipos REALES a cero. No es inventar nada:
    // "estos veinte juegan LaLiga 2026/27 y llevan cero puntos porque no se ha
    // jugado nada" es cierto. Y la pestaña sirve para algo desde el primer dia:
    // se ve quien esta en la liga. En cuanto ruede el balon, la API deja de
    // contradecirse y esta rama no vuelve a entrar.
    if (report.looksPreviousSeason) {
      const alfabetico = [...TEAM_CODES].sort((a, b) =>
        TEAMS[a].name.localeCompare(TEAMS[b].name, 'es'),
      )
      for (const [i, code] of alfabetico.entries()) {
        standingRows.push({
          team_code: code,
          position: i + 1,
          points: 0,
          played_games: 0,
          goals_for: 0,
          goals_against: 0,
          form: [],
          updated_at: fetchedAt,
        })
      }
      report.warnings.push(
        'La API sirve todavia la clasificacion FINAL de la temporada anterior (dice ' +
          `currentMatchday=${currentMatchday} pero manda filas con partidos jugados, y entre ellas ` +
          'equipos descendidos). NO se guarda: se siembran los 20 equipos de la temporada actual a ' +
          'cero, ordenados alfabeticamente. Se corrige sola en cuanto se juegue la primera jornada.',
      )
    }

    for (const row of report.looksPreviousSeason ? [] : table) {
      const code = resolveTeamById(row.team)
      if (!code) {
        // INVARIANTE 1: no se adivina. Un descendido de la temporada pasada, un
        // ascendido nuevo o un club rebautizado se anotan y se saltan.
        if (row.team && typeof row.team.id === 'number') {
          unknownById.set(row.team.id, {
            id: row.team.id,
            name: row.team.name,
            tla: row.team.tla,
          })
        }
        continue
      }
      if (seenCodes.has(code)) {
        report.warnings.push(`Dos filas de la clasificacion resuelven a ${code}; se ignora la segunda.`)
        continue
      }
      seenCodes.add(code)

      const form = parseForm(row.form)
      if (form.length > 0) report.standingsWithForm += 1

      const position = toInt(row.position, 0)
      // La restriccion `competition_standings_position_range` rechazaria un 0 y
      // se llevaria por delante el upsert de los otros 19. Mejor saltar la fila
      // mala y avisar que perder la tabla entera.
      if (position < 1 || position > 20) {
        report.warnings.push(`${code}: posicion ${position} fuera de rango; fila descartada.`)
        seenCodes.delete(code)
        continue
      }

      standingRows.push({
        team_code: code,
        position,
        points: toInt(row.points, 0),
        played_games: toInt(row.playedGames, 0),
        goals_for: toInt(row.goalsFor, 0),
        goals_against: toInt(row.goalsAgainst, 0),
        form,
        updated_at: fetchedAt,
      })
    }

    // INVARIANTE 2: upsert primero y borrado despues, para que la tabla no pase
    // NUNCA por el vacio. Solo se toca si la API ha dado algo: una respuesta sin
    // tabla no puede borrar la clasificacion buena.
    if (standingRows.length > 0) {
      const { data: written, error } = await admin
        .from('competition_standings')
        .upsert(standingRows, { onConflict: 'team_code' })
        .select('team_code')
      if (error) {
        throw isMissingTable(error.message)
          ? missingTableError(error.message)
          : new Error(`Escritura en competition_standings fallida: ${error.message}`)
      }
      report.standingsWritten = written?.length ?? 0

      const codes = standingRows.map((row) => row.team_code)
      const { data: removed, error: deleteError } = await admin
        .from('competition_standings')
        .delete()
        // Los codigos son tres letras mayusculas validadas por la restriccion de
        // la tabla: no hay nada que escapar aqui.
        .not('team_code', 'in', `(${codes.join(',')})`)
        .select('team_code')
      if (deleteError) {
        throw new Error(`Limpieza de competition_standings fallida: ${deleteError.message}`)
      }
      report.standingsRemoved = removed?.length ?? 0
    }

    // ---- 2. Goleadores ------------------------------------------------------

    const scorersLimit = options.scorersLimit ?? DEFAULT_SCORERS_LIMIT
    const { data: scorersPayload, rateLimit: scorersRate } = await fdGet<FdScorersResponse>(
      `/competitions/${COMPETITION_CODE}/scorers`,
      { limit: scorersLimit, season: options.season },
    )
    // La cuota que vale es la de la ULTIMA peticion: es la que dice cuanto queda.
    report.rateLimit = scorersRate

    const scorers = scorersPayload.scorers ?? []
    report.scorersFetched = scorers.length

    const scorerRows: ScorerRow[] = []
    for (const entry of scorers) {
      const name = entry.player?.name?.trim()
      // Un goleador sin nombre no se puede pintar y no se guarda. No se inventa
      // ningun nombre de futbolista: es un dato real o no es nada.
      if (!name) {
        report.warnings.push('Un goleador venia sin nombre en la API; se ha descartado.')
        continue
      }

      const code = resolveTeamById(entry.team)
      if (!code && entry.team && typeof entry.team.id === 'number') {
        unknownById.set(entry.team.id, { id: entry.team.id, name: entry.team.name, tla: entry.team.tla })
      }
      if (!code) report.scorersWithoutTeam += 1

      scorerRows.push({
        // El puesto sale del ORDEN de la API, que es quien decide los desempates.
        rank: scorerRows.length + 1,
        player_name: name,
        team_code: code,
        goals: toInt(entry.goals, 0),
        assists: toIntOrNull(entry.assists),
        updated_at: fetchedAt,
      })
    }

    if (scorerRows.length > 0) {
      const { data: written, error } = await admin
        .from('competition_scorers')
        .upsert(scorerRows, { onConflict: 'rank' })
        .select('rank')
      if (error) {
        throw isMissingTable(error.message)
          ? missingTableError(error.message)
          : new Error(`Escritura en competition_scorers fallida: ${error.message}`)
      }
      report.scorersWritten = written?.length ?? 0
    }

    // INVARIANTE 3: con `scorerRows` vacio esto borra la tabla entera y termina
    // bien, que es justo lo que tiene que pasar hoy (`/scorers` devuelve `[]`
    // hasta la primera jornada). `rank` empieza en 1, asi que `> 0` alcanza a
    // todas las filas y el delete NUNCA va sin filtro.
    const { data: removedScorers, error: scorersDeleteError } = await admin
      .from('competition_scorers')
      .delete()
      .gt('rank', scorerRows.length)
      .select('rank')
    if (scorersDeleteError) {
      throw isMissingTable(scorersDeleteError.message)
        ? missingTableError(scorersDeleteError.message)
        : new Error(`Limpieza de competition_scorers fallida: ${scorersDeleteError.message}`)
    }
    report.scorersRemoved = removedScorers?.length ?? 0

    // ---- 3. Avisos ----------------------------------------------------------

    report.unknownTeams = [...unknownById.values()]
    if (report.unknownTeams.length > 0) {
      const detail = report.unknownTeams.map((t) => `${t.name ?? '?'} (id ${t.id}, tla ${t.tla ?? '?'})`).join(', ')
      report.warnings.push(
        `${report.unknownTeams.length} equipo(s) sin emparejar, saltados: ${detail}. Si alguno es ` +
          'de nuestra liga, anadelo a TEAM_ID_OVERRIDES en src/lib/football-data/ingest.ts. Si es ' +
          'un descendido de la temporada pasada, esto es lo esperado.',
      )
    }
    // El aviso de `looksPreviousSeason` ya lo pone donde se decide sembrar los 20
    // a cero, arriba. Repetirlo aqui, ademas, diria "se guarda igual", que dejo
    // de ser verdad en cuanto se decidio NO guardar la tabla vieja.
    if (report.scorersFetched === 0) {
      report.warnings.push(
        'La API no da ningun goleador todavia: no se ha jugado nada. La tabla queda vacia a ' +
          'proposito y la pantalla tiene que decir que aun no ha marcado nadie.',
      )
    }
    if (report.standingsFetched > 0 && report.standingsWithForm === 0) {
      report.warnings.push(
        'Ningun equipo trae racha (`form` llega null). Las filas de partido se pintaran sin ' +
          'racha hasta que la API empiece a publicarla.',
      )
    }

    report.ok = true
  } catch (error) {
    report.ok = false
    report.error = error instanceof Error ? error.message : String(error)
    if (error instanceof FootballDataError) {
      report.retryable = error.retryable
      if (error.rateLimit) report.rateLimit = error.rateLimit
    }
    report.unknownTeams = [...unknownById.values()]
  }

  report.durationMs = Date.now() - startedAt
  return report
}
