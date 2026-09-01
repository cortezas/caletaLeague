/**
 * Sincronizacion de PLANTILLAS football-data.org -> Supabase (`public.team_squads`).
 *
 * El plan gratuito SI da plantillas: `GET /v4/competitions/PD/teams` devuelve los
 * 20 equipos y, dentro de cada uno, su `squad`. Una sola peticion para las 20.
 * Lo que NO da en ningun caso: goleadores por partido, alineaciones y fotos.
 *
 * TRES INVARIANTES QUE NO SE NEGOCIAN
 *
 * 1. **Una fila con `source='admin'` no se toca jamas.** Si el organizador
 *    corrigio la plantilla a mano desde /ajustes/admin, su version manda sobre la
 *    de la API para siempre. La ingesta la cuenta en `preservedByAdmin` y sigue.
 *
 * 2. **Una plantilla vacia no se escribe.** Si la API devuelve `squad: []` para
 *    un equipo, guardarlo borraria la lista buena que ya hubiera. Se salta y se
 *    avisa. Una plantilla CORTA (el Atletico trae 5 jugadores) si se escribe:
 *    son datos reales aunque incompletos, y salen en `shortSquads` para que el
 *    organizador sepa a quien le toca completar a mano.
 *
 * 3. **Nunca revienta.** Devuelve siempre un informe; los fallos van en `error`.
 *    Que la API se caiga o que falte el token no puede tumbar la sincronizacion
 *    de partidos, que es la que de verdad hace falta para jugar.
 *
 * SOLO SERVIDOR: usa la service role key, que se salta RLS (en `team_squads`
 * solo escribe el administrador). Nunca importar esto desde un Client Component.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SEASON } from '@/lib/laliga'
import { normalizePlayer } from '@/lib/squads'
import type { TeamCode } from '@/lib/types'
import { COMPETITION_CODE, FootballDataError } from './client'
import { resolveTeamCode, type UnknownTeam } from './ingest'
import type { FdCompetitionRef, FdRateLimit, FdTeamRef } from './types'

// ---------------------------------------------------------------------------
// Tipos de la respuesta (verificados contra la API real el 11/08/2026)
// ---------------------------------------------------------------------------

/**
 * Un jugador dentro de `team.squad`. Solo se consume `name`: la app compara
 * jugadores por nombre (`samePlayer`), no por id de football-data.org, porque el
 * organizador y la pena escriben texto libre.
 */
export interface FdSquadPlayer {
  id: number
  name: string | null
  /** `Goalkeeper`, `Defence`, `Midfield`, `Offence`. Hoy no se usa. */
  position: string | null
  dateOfBirth?: string | null
  nationality?: string | null
}

/** Un equipo del listado de la competicion. Es un `FdTeamRef` con extras. */
export interface FdTeam extends FdTeamRef {
  /** Ausente o vacio en equipos que la API no tiene fichados. */
  squad?: FdSquadPlayer[] | null
}

/** Respuesta de `GET /v4/competitions/{code}/teams`. */
export interface FdCompetitionTeamsResponse {
  count: number
  /** Eco de los filtros. `season` viene como string: `"2026"`. */
  filters: { season?: string }
  competition: FdCompetitionRef
  teams: FdTeam[]
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

/** Equipo cuya plantilla es sospechosamente corta: falta gente por fichar. */
export interface ShortSquad {
  code: TeamCode
  name: string | null
  size: number
}

export interface SquadSyncReport {
  ok: boolean
  /** Mensaje cuando `ok` es false. La sincronizacion de partidos no se entera. */
  error?: string
  /** `true` si el fallo es transitorio (429, 5xx, red) y merece reintento. */
  retryable?: boolean
  /** Temporada que ha devuelto la API (`filters.season`), p. ej. `"2026"`. */
  apiSeason: string | null
  expectedSeason: string
  leagueId: string | null
  /** Equipos que ha devuelto la API. Deberian ser 20. */
  teamsFetched: number
  /** Filas escritas en `team_squads` con `source='api'`. */
  upserted: number
  /** Filas NO tocadas porque las corrigio el organizador (`source='admin'`). */
  preservedByAdmin: TeamCode[]
  /**
   * Jugadores a los que la API ha cambiado el nombre en esta pasada, y cuantas
   * filas se han reescrito por cada uno. `rows: -1` = el renombrado fallo y hay
   * que mirarlo: esos puntos estan en el aire.
   */
  renamed: Array<{ code: TeamCode; from: string; to: string; rows: number }>
  /** Equipos con menos de 18 jugadores: la API no los tiene completos. */
  shortSquads: ShortSquad[]
  /** Equipos que la API devuelve sin ningun jugador. No se escriben. */
  emptySquads: Array<{ id: number; name: string | null }>
  /** Equipos que no sabemos traducir a un `TeamCode`. */
  unknownTeams: UnknownTeam[]
  warnings: string[]
  rateLimit: FdRateLimit
  durationMs: number
}

export interface SquadSyncOptions {
  /** Liga destino. Si se omite, `SYNC_LEAGUE_ID` o la unica liga que haya. */
  leagueId?: string
  /** Ano de inicio de temporada. Por defecto, la que la API considere actual. */
  season?: number
  /**
   * Por defecto se ABORTA si la API sirve una temporada distinta a la de
   * `laliga.ts`: escribir las plantillas del ano que viene sobre las de este
   * dejaria a la pena pronosticando con jugadores que ya no estan.
   */
  allowSeasonMismatch?: boolean
}

/**
 * Por debajo de esto la plantilla no es creible para una primera division: 18 es
 * el tamano minimo de una convocatoria larga. Es un umbral de AVISO, no un fallo.
 */
const SHORT_SQUAD_THRESHOLD = 18

const EMPTY_RATE_LIMIT: FdRateLimit = { availableMinute: null, resetSeconds: null }

// ---------------------------------------------------------------------------
// Peticion
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.football-data.org/v4'

/**
 * `GET /v4/competitions/PD/teams` - UNA peticion, las 20 plantillas.
 *
 * No sale de `client.ts` porque su `fdFetch` es privado y ese fichero pertenece
 * a otro lote. Comparte con el las dos cosas que importan: la cabecera
 * `X-Auth-Token` (nunca en la query string, acabaria en los logs del proxy) y el
 * tipo de error, para que quien llame no tenga que distinguir dos familias.
 */
async function fetchCompetitionTeams(
  season: number | undefined,
  timeoutMs = 15_000,
): Promise<{ data: FdCompetitionTeamsResponse; rateLimit: FdRateLimit }> {
  // El token se lee en cada llamada, no al importar el modulo: asi un despliegue
  // que anade la variable no necesita reiniciar el proceso para que la ingesta
  // empiece a funcionar.
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token) {
    // `Error` pelado y no `FootballDataError` a proposito: esta ultima marca como
    // reintentable todo lo que no llego a la red (status 0), y un token que falta
    // no se arregla reintentando. Un cron que lo tratara como transitorio se
    // pasaria la vida repitiendo la misma pasada fallida.
    throw new Error(
      'Falta FOOTBALL_DATA_TOKEN. Las plantillas se leen de football-data.org; sin token no ' +
        'hay ingesta de plantillas. La app sigue funcionando: los nombres de jugador se ' +
        'escriben en texto libre y el organizador puede pegar cada plantilla a mano desde ' +
        '/ajustes/admin.',
    )
  }

  const url = new URL(`${API_BASE}/competitions/${COMPETITION_CODE}/teams`)
  if (season !== undefined) url.searchParams.set('season', String(season))

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'X-Auth-Token': token, Accept: 'application/json' },
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

  const data = (await response.json()) as FdCompetitionTeamsResponse
  return { data, rateLimit }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/**
 * `team_squads` solo admite escritura del admin `authenticated`; el cron no tiene
 * sesion. De ahi la service role key, que se salta RLS. NUNCA con prefijo
 * `NEXT_PUBLIC_`.
 */
function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. La ingesta escribe en ' +
        'team_squads, cuya politica RLS solo admite al admin, asi que necesita la service role key.',
    )
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function resolveLeagueId(admin: SupabaseClient, explicit?: string): Promise<string> {
  const configured = explicit ?? process.env.SYNC_LEAGUE_ID
  if (configured) return configured

  const { data, error } = await admin.from('leagues').select('id').limit(2)
  if (error) throw new Error(`No se pudo leer leagues: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No hay ninguna liga en Supabase. Aplica supabase/seed.sql antes de sincronizar.')
  }
  if (data.length > 1) {
    throw new Error('Hay mas de una liga: configura SYNC_LEAGUE_ID para decir cual se alimenta de la API.')
  }
  return data[0].id as string
}

/** La tabla la crea el lote A. Sin ella, un mensaje que diga que hacer. */
function missingTableError(message: string): Error {
  return new Error(
    'Falta la tabla `public.team_squads`. Aplica la migracion del lote A ' +
      `(supabase/migrations, ver docs/INGESTA.md 5.3). Detalle de PostgREST: ${message}`,
  )
}

function isMissingTable(message: string): boolean {
  return /team_squads/i.test(message) && /(does not exist|schema cache|no existe)/i.test(message)
}

/**
 * Nombres listos para guardar: recortados, sin vacios y sin repetidos.
 *
 * El duplicado se detecta con `normalizePlayer`, la misma funcion con la que
 * despues se puntua (`samePlayer`): si dos entradas de la API solo se
 * diferencian en una tilde, para la app ya son el mismo jugador y tener las dos
 * en el desplegable solo confunde. Se conserva la PRIMERA grafia y el orden de
 * la API, que viene por posicion (porteros, defensas, medios, delanteros).
 */
function cleanPlayerNames(squad: FdSquadPlayer[]): { names: string[]; ids: number[] } {
  const seen = new Set<string>()
  const names: string[] = []
  const ids: number[] = []
  for (const player of squad) {
    const name = player.name?.trim()
    if (!name) continue
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    names.push(name)
    // El id se guardaba en la basura. Es lo unico estable que da la API: el
    // nombre lo reescribe cuando quiere, y ese cambio silencioso costo 16
    // aciertos el 31/08/2026. Con el id, un renombrado es DETECTABLE.
    ids.push(player.id)
  }
  return { names, ids }
}

// ---------------------------------------------------------------------------
// Ingesta
// ---------------------------------------------------------------------------

interface SquadRow {
  league_id: string
  team_code: TeamCode
  players: string[]
  /** En el MISMO orden que `players`. Es lo que hace detectable un renombrado. */
  player_ids: number[]
  source: 'api'
}

export async function syncSquads(options: SquadSyncOptions = {}): Promise<SquadSyncReport> {
  const startedAt = Date.now()
  const report: SquadSyncReport = {
    ok: false,
    apiSeason: null,
    expectedSeason: SEASON,
    leagueId: null,
    teamsFetched: 0,
    upserted: 0,
    preservedByAdmin: [],
    renamed: [],
    shortSquads: [],
    emptySquads: [],
    unknownTeams: [],
    warnings: [],
    rateLimit: EMPTY_RATE_LIMIT,
    durationMs: 0,
  }

  try {
    const { data: payload, rateLimit } = await fetchCompetitionTeams(options.season)
    report.rateLimit = rateLimit
    report.teamsFetched = payload.teams?.length ?? 0
    report.apiSeason = payload.filters?.season ?? null

    // `SEASON` es '2026-27'; la API responde con el ano de inicio, '2026'.
    const expectedStartYear = SEASON.split('-')[0]
    if (report.apiSeason && report.apiSeason !== expectedStartYear) {
      const message =
        `La API sirve las plantillas de la temporada ${report.apiSeason} y laliga.ts espera la ` +
        `${SEASON}. Ingesta de plantillas abortada para no dejar a la pena eligiendo jugadores ` +
        'de otra temporada.'
      if (!options.allowSeasonMismatch) throw new Error(message)
      report.warnings.push(message)
    }

    const admin = createAdminClient()
    const leagueId = await resolveLeagueId(admin, options.leagueId)
    report.leagueId = leagueId

    // ---- 1. Lo que ya hay: quien es del admin y quien de la API -------------

    const { data: stored, error: readError } = await admin
      .from('team_squads')
      .select('team_code, source, players, player_ids')
      .eq('league_id', leagueId)
    if (readError) {
      throw isMissingTable(readError.message)
        ? missingTableError(readError.message)
        : new Error(`No se pudo leer team_squads: ${readError.message}`)
    }

    const adminOwned = new Set<string>(
      (stored ?? []).filter((row) => row.source === 'admin').map((row) => row.team_code as string),
    )
    const alreadyStored = new Set<string>((stored ?? []).map((row) => row.team_code as string))

    /** Los renombrados que ha hecho la API en esta pasada. */
    const renombrados: Array<{ code: TeamCode; from: string; to: string }> = []

    /** La grafia con la que se guardo cada jugador la ultima vez, por id. */
    type Guardado = { players: string[] | null; player_ids: number[] | null }
    const guardadoPorEquipo = new Map<string, Guardado>()
    for (const row of stored ?? []) {
      const r = row as unknown as { team_code: string } & Guardado
      guardadoPorEquipo.set(r.team_code, { players: r.players, player_ids: r.player_ids })
    }

    // ---- 2. Traduccion y filtrado ------------------------------------------

    const rows: SquadRow[] = []
    const seenCodes = new Set<TeamCode>()

    for (const team of payload.teams ?? []) {
      const code = resolveTeamCode(team)
      if (!code) {
        // Un ascendido nuevo o un rebautizo se anota y se sigue: nunca tumba a
        // los otros 19.
        report.unknownTeams.push({ id: team.id, name: team.name, tla: team.tla })
        continue
      }
      if (seenCodes.has(code)) {
        report.warnings.push(`Dos equipos de la API resuelven a ${code}; se ignora el id ${team.id}.`)
        continue
      }
      seenCodes.add(code)

      // INVARIANTE 1: lo que corrigio el organizador manda. Va lo primero: si la
      // fila es suya, lo que diga la API de ese equipo no importa, ni siquiera
      // para avisar de que viene corta (ya la ha completado el).
      if (adminOwned.has(code)) {
        report.preservedByAdmin.push(code)
        continue
      }

      const { names: players, ids: playerIds } = cleanPlayerNames(team.squad ?? [])

      // INVARIANTE 2: una plantilla vacia no borra la que ya hay.
      if (players.length === 0) {
        report.emptySquads.push({ id: team.id, name: team.name })
        continue
      }

      if (players.length < SHORT_SQUAD_THRESHOLD) {
        report.shortSquads.push({ code, name: team.name, size: players.length })
      }

      // `updated_at` no va en el payload: lo pone el default al insertar y el
      // trigger `team_squads_touch_updated_at` (migracion 0008) al actualizar.
      // ¿Ha renombrado la API a alguien? Mismo id, nombre distinto.
      //
      // Esto es para lo que se guarda el id. Sin el, un cambio de grafia es
      // invisible: la plantilla nueva simplemente deja de casar con lo que la
      // peña tiene pronosticado, y los puntos se caen sin que salte nada.
      const antes = guardadoPorEquipo.get(code)
      if (antes?.player_ids && antes.players) {
        const nombrePorId = new Map<number, string>()
        antes.player_ids.forEach((id, i) => {
          const n = antes.players?.[i]
          if (typeof n === 'string') nombrePorId.set(id, n)
        })
        playerIds.forEach((id, i) => {
          // `0` es el hueco que dejo el relleno inicial para los nombres que la
          // API ya no tenia. No identifica a nadie, asi que no puede disparar un
          // renombrado.
          if (id <= 0) return
          const viejo = nombrePorId.get(id)
          const nuevo = players[i]
          if (viejo && nuevo && normalizePlayer(viejo) !== normalizePlayer(nuevo)) {
            renombrados.push({ code, from: viejo, to: nuevo })
          }
        })
      }

      rows.push({ league_id: leagueId, team_code: code, players, player_ids: playerIds, source: 'api' })
    }

    // ---- 3. Escritura -------------------------------------------------------
    //
    // Dos caminos, y no es capricho. La migracion 0008 exige que el UPDATE lleve
    // `where source = 'api'`; PostgREST no sabe poner condiciones en el DO UPDATE
    // de un upsert, asi que el guardia tendria que quedarse en el filtro por
    // memoria de arriba... y entre la lectura y la escritura cabe justo el
    // instante en que el organizador da a guardar su correccion. Por eso:
    //
    //   - los equipos que aun no tienen fila van en UN insert con
    //     `ignoreDuplicates`, que en PostgREST es un `on conflict do nothing`;
    //   - los que ya la tienen van uno a uno con `.eq('source', 'api')` en el
    //     WHERE, que es la unica forma de que el guardia lo evalue Postgres.
    //
    // Son ~20 updates por pasada, no 20.000: la tabla tiene una fila por equipo.

    const newRows = rows.filter((row) => !alreadyStored.has(row.team_code))
    const updates = rows.filter((row) => alreadyStored.has(row.team_code))

    const failWrite = (message: string): never => {
      throw isMissingTable(message)
        ? missingTableError(message)
        : new Error(`Escritura en team_squads fallida: ${message}`)
    }

    if (newRows.length > 0) {
      const { data: inserted, error: insertError } = await admin
        .from('team_squads')
        .upsert(newRows, { onConflict: 'league_id,team_code', ignoreDuplicates: true })
        .select('team_code')
      if (insertError) failWrite(insertError.message)
      report.upserted += inserted?.length ?? 0
    }

    const escritos = new Set<TeamCode>()
    for (const row of updates) {
      const { data: touched, error: updateError } = await admin
        .from('team_squads')
        .update({ players: row.players, player_ids: row.player_ids })
        .eq('league_id', row.league_id)
        .eq('team_code', row.team_code)
        // INVARIANTE 1, esta vez evaluado por Postgres y no por memoria.
        .eq('source', 'api')
        .select('team_code')
      if (updateError) failWrite(updateError.message)
      if ((touched?.length ?? 0) > 0) {
        report.upserted += 1
        escritos.add(row.team_code)
      } else {
        // La fila paso a 'admin' entre la lectura y este update: el organizador
        // gano la carrera, que es exactamente lo que tiene que pasar.
        report.preservedByAdmin.push(row.team_code)
      }
    }

    // ---- 4. Los renombrados ------------------------------------------------
    //
    // DESPUES de escribir la plantilla y SOLO de los equipos cuya fila se ha
    // escrito de verdad: si el organizador gano la carrera, su grafia manda y no
    // hay nada que renombrar.
    //
    // Esto es lo que evita que un cambio de nombre de football-data se lleve por
    // delante los aciertos de la peña. `prediction_points` y `standings` son
    // vistas que se recalculan desde los nombres de hoy, asi que sin este paso un
    // renombrado no cuesta una jornada: reescribe la temporada hacia atras.
    for (const cambio of renombrados) {
      if (!escritos.has(cambio.code)) continue
      const { data: tocadas, error: renameError } = await admin.rpc('renombrar_jugador', {
        p_team_code: cambio.code,
        p_viejo: cambio.from,
        p_nuevo: cambio.to,
      })
      // Un fallo aqui no puede tumbar la sincronizacion: la plantilla ya esta
      // escrita y lo importante es que quede constancia para mirarlo.
      report.renamed.push({
        code: cambio.code,
        from: cambio.from,
        to: cambio.to,
        rows: renameError ? -1 : ((tocadas as number | null) ?? 0),
      })
    }

    if (report.shortSquads.length > 0) {
      const detail = report.shortSquads.map((s) => `${s.code} (${s.size})`).join(', ')
      report.warnings.push(
        `Plantilla incompleta en la API para ${detail}. No es un fallo de la ingesta: la ficha ` +
          'de football-data.org viene asi. Completala a mano desde /ajustes/admin, y esa fila ' +
          "pasara a source='admin' y dejara de sobrescribirse.",
      )
    }
    if (report.emptySquads.length > 0) {
      report.warnings.push(
        `${report.emptySquads.length} equipo(s) sin ningun jugador en la API. No se han escrito: ` +
          'guardar una lista vacia borraria la que ya hubiera.',
      )
    }
    if (report.unknownTeams.length > 0) {
      report.warnings.push(
        `${report.unknownTeams.length} equipo(s) sin mapear. Anadelos a TEAM_ID_OVERRIDES en ` +
          'src/lib/football-data/ingest.ts con el id que aparece en `unknownTeams`.',
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
  }

  report.durationMs = Date.now() - startedAt
  return report
}
