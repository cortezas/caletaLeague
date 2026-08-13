/**
 * Alineaciones: el once, el banquillo y quien ha apostado por alguien que NO esta.
 *
 * PARA QUE SIRVE
 * Media hora antes del pitido inicial se sabe quien juega. Si Curro tiene a
 * Mbappé de goleador y Mbappé no esta ni en el banquillo, avisarle a tiempo vale
 * mas que cualquier otra funcion de esta app.
 *
 * ESTE FICHERO NO MANDA NADA. Devuelve la lista de "apuestas a jugador no
 * convocado" y ahi se acaba su trabajo. El envio vive en `src/lib/push/`, que es
 * de otro lote. Como engancharlo esta en docs/EVENTOS.md, seccion 6.
 *
 * QUIEN LLAMA A LA API: SOLO EL CRON (`syncLineups`, al final de este fichero).
 * La alineacion se guarda en `public.match_lineups` (migracion 0013) y la app la
 * lee de ahi con `getMatchLineups()` de `src/lib/data/lineups.ts`. Si la pidiera
 * la pantalla, doce personas abriendo el mismo partido serian doce peticiones de
 * las 100 que da el plan gratuito AL DIA.
 *
 * LO QUE NO SABEMOS (y hay que decirlo)
 * **No esta verificado que `GET /lineups/{matchId}` devuelva algo ANTES del
 * partido.** Puede que la API solo publique la alineacion cuando el partido ya
 * ha empezado. Se ha probado con partidos ya jugados, donde obviamente esta.
 * Solo se puede comprobar en directo el sabado 15 a las 18:30, una hora antes
 * del Alavés-Getafe. Por eso `syncLineups` esta escrito para no gastar de mas
 * mientras tanto: si la API contesta con la alineacion vacia o a medias, NO
 * guarda nada y lo cuenta en el informe.
 *
 * COSTE: 1 peticion por partido y pasada, mas 1 por dia consultado. El desglose
 * por jornada esta en el comentario de `syncLineups`.
 *
 * SOLO SERVIDOR.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { normalizePlayer } from '@/lib/squads'
import type { TeamCode } from '@/lib/types'
import {
  BudgetExhaustedError,
  getMatchesByDate,
  getMatchLineups,
  HighlightlyError,
  isHighlightlyConfigured,
  RequestBudget,
  type HlFetchOptions,
} from './client'
import {
  linkMatches,
  madridDate,
  resolveApiMatch,
  resolveHighlightlyTeam,
  type LinkFailure,
  type LocalMatch,
  type ResolvedApiMatch,
} from './match-link'
import type { HlLineupPlayer, HlLineupSide } from './types'

// ---------------------------------------------------------------------------
// Lectura de la respuesta
// ---------------------------------------------------------------------------

/** Un jugador de la alineacion, ya limpio. */
export interface LineupPlayer {
  /** Nombre COMPLETO, tal cual lo da la API ("Ayoze Pérez"). */
  name: string
  number: number | null
  position: string | null
  /** Id de Highlightly. Mismo espacio que `HlEvent.playerId`. */
  id: string | null
}

export interface TeamLineup {
  /** Nombre del equipo segun la API, sin traducir. */
  apiName: string | null
  /** `null` si el nombre no esta en `HIGHLIGHTLY_TEAM_ALIASES`. */
  code: TeamCode | null
  formation: string | null
  starters: LineupPlayer[]
  substitutes: LineupPlayer[]
  /** Once + banquillo: el universo de gente que puede jugar este partido. */
  available: LineupPlayer[]
}

export interface MatchLineups {
  home: TeamLineup
  away: TeamLineup
  /** `true` si los dos equipos traen al menos un titular. */
  complete: boolean
}

/** El dorsal, que la API manda como numero o como cadena. `null` si no viene. */
function readNumber(raw: number | string | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * `initialLineup` puede venir como lista plana o como lista de lineas (el dibujo
 * tactico agrupado por posicion). Se aplanan las dos formas: aqui no interesa la
 * formacion, interesa quien esta.
 */
function flattenPlayers(raw: HlLineupPlayer[] | HlLineupPlayer[][] | null | undefined): LineupPlayer[] {
  if (!Array.isArray(raw)) return []
  const flat: HlLineupPlayer[] = []
  for (const entry of raw) {
    if (Array.isArray(entry)) flat.push(...entry)
    else if (entry) flat.push(entry)
  }
  const out: LineupPlayer[] = []
  const seen = new Set<string>()
  for (const player of flat) {
    const name = player?.name?.trim()
    if (!name) continue
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      // `Number(null)` es 0 y `Number('')` tambien: sin descartar los vacios
      // antes de convertir, un jugador sin dorsal se guardaria con el 0, que no
      // es un dorsal de verdad y acabaria pintado en la camiseta.
      number: readNumber(player.number),
      position: player.position?.trim() || null,
      id: player.id === null || player.id === undefined ? null : String(player.id),
    })
  }
  return out
}

function readSide(side: HlLineupSide | null | undefined, resolveCode: (name: string | null) => TeamCode | null): TeamLineup {
  const apiName = side?.name?.trim() || null
  const starters = flattenPlayers(side?.initialLineup)
  const substitutes = flattenPlayers(side?.substitutes)
  return {
    apiName,
    code: resolveCode(apiName),
    formation: side?.formation?.trim() || null,
    starters,
    substitutes,
    available: [...starters, ...substitutes],
  }
}

/**
 * Trae la alineacion de un partido. **1 peticion.**
 *
 * `matchId` es el id de HIGHLIGHTLY, no el nuestro: sale de `linkMatches()` en
 * `match-link.ts` (`pair.api.apiId`). Pasar aqui un `matches.id` de Supabase
 * devuelve 404, no un error entendible.
 */
export async function getLineups(
  apiMatchId: string | number,
  options: HlFetchOptions = {},
): Promise<MatchLineups> {
  const resolveCode = (name: string | null) => (name ? resolveHighlightlyTeam(name) : null)

  const payload = await getMatchLineups(apiMatchId, options)
  const home = readSide(payload.homeTeam, resolveCode)
  const away = readSide(payload.awayTeam, resolveCode)
  return {
    home,
    away,
    complete: home.starters.length > 0 && away.starters.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Quien ha apostado por alguien que no esta
// ---------------------------------------------------------------------------

/** Un pronostico, con lo justo para comprobarlo contra la alineacion. */
export interface PredictionPlayers {
  memberId: string
  /** Para el texto del aviso. */
  displayName?: string
  mvp?: string | null
  scorers?: string[] | null
  assists?: string[] | null
}

/** Un jugador pronosticado que no esta convocado, y en que casilla estaba. */
export interface MissingPick {
  memberId: string
  displayName?: string
  player: string
  slot: 'mvp' | 'scorer' | 'assist'
}

export interface MissingPicksResult {
  /** `false` cuando la alineacion no esta completa: entonces `picks` va vacio. */
  usable: boolean
  reason?: string
  picks: MissingPick[]
  /** Cuantos nombres se han comprobado. Para saber si el resultado dice algo. */
  checked: number
}

/**
 * Quien de la peña ha apostado por alguien que NO esta en la convocatoria.
 *
 * REGLA DE PRUDENCIA: si la alineacion no esta completa (falta un equipo, o
 * ninguno de los dos trae titulares) NO se devuelve nada. Un aviso falso de
 * "tu goleador no juega" a media peña es peor que no avisar: el que lo reciba
 * cambiara un pronostico que estaba bien, y encima dejara de fiarse del aviso
 * la proxima vez, que es cuando si sera verdad.
 *
 * La comparacion usa `normalizePlayer`, la misma de `samePlayer` y de
 * `norm_player` en SQL: si aqui se comparase de otra forma, esta funcion diria
 * "no esta convocado" de alguien que el calculo de puntos si reconoce.
 *
 * Un nombre vacio no se comprueba: "no he elegido goleador" no es un fallo.
 */
export function findMissingPicks(
  lineups: MatchLineups,
  predictions: PredictionPlayers[],
): MissingPicksResult {
  if (!lineups.complete) {
    return {
      usable: false,
      reason:
        'La alineacion no esta completa (falta algun equipo o ningun titular). No se avisa a nadie: ' +
        'un aviso falso de "tu goleador no juega" hace mas dano que no avisar.',
      picks: [],
      checked: 0,
    }
  }

  const available = new Set<string>()
  for (const player of [...lineups.home.available, ...lineups.away.available]) {
    const key = normalizePlayer(player.name)
    if (key !== '') available.add(key)
  }

  const picks: MissingPick[] = []
  let checked = 0

  const check = (
    prediction: PredictionPlayers,
    raw: string | null | undefined,
    slot: MissingPick['slot'],
  ) => {
    const name = raw?.trim()
    if (!name) return
    const key = normalizePlayer(name)
    if (key === '') return
    checked += 1
    if (available.has(key)) return
    picks.push({
      memberId: prediction.memberId,
      displayName: prediction.displayName,
      player: name,
      slot,
    })
  }

  for (const prediction of predictions) {
    check(prediction, prediction.mvp, 'mvp')
    for (const scorer of prediction.scorers ?? []) check(prediction, scorer, 'scorer')
    for (const assist of prediction.assists ?? []) check(prediction, assist, 'assist')
  }

  return { usable: true, picks, checked }
}

/**
 * Agrupa los avisos por miembro: una notificacion por persona, no una por
 * jugador. Tres jugadores fuera son tres lineas del mismo mensaje, no tres
 * vibraciones seguidas en el movil.
 */
export function groupMissingPicksByMember(
  picks: MissingPick[],
): Array<{ memberId: string; displayName?: string; players: string[] }> {
  const byMember = new Map<string, { memberId: string; displayName?: string; players: string[] }>()
  for (const pick of picks) {
    const entry = byMember.get(pick.memberId) ?? {
      memberId: pick.memberId,
      displayName: pick.displayName,
      players: [],
    }
    if (!entry.players.includes(pick.player)) entry.players.push(pick.player)
    byMember.set(pick.memberId, entry)
  }
  return [...byMember.values()]
}

// ---------------------------------------------------------------------------
// El paso del cron: traer las alineaciones y GUARDARLAS
// ---------------------------------------------------------------------------

/**
 * Ventana de caza, en minutos antes del pitido inicial. Las alineaciones
 * oficiales salen alrededor de una hora antes; 90 minutos deja margen para el
 * club que la publica pronto sin ponerse a preguntar por la mañana.
 *
 * DESPUES DEL PITIDO INICIAL NO SE PIDE MAS. Es deliberado: el valor de esta
 * funcion es que la peña vea el once mientras aun puede cambiar el pronostico.
 * Un partido cuya alineacion no se consiguio a tiempo se queda sin ella y en la
 * pantalla sale "No disponible todavia", que es honesto y cuesta cero peticiones.
 */
const WINDOW_MINUTES = 90

/**
 * Tope de peticiones de ESTA pasada. Doce, no cuarenta como el paso de
 * goleadores: en 90 minutos rara vez arrancan mas de un par de partidos a la vez,
 * y en la unica jornada donde arrancan los diez a la vez (la ultima) doce es
 * exactamente 1 de listado + 10 de alineaciones + 1 de margen.
 */
const DEFAULT_MAX_REQUESTS = 12

/** Sin once completo no se guarda: una alineacion a medias no es una alineacion. */
const MIN_STARTERS = 11

export type LineupOutcomeStatus =
  /** Guardada. No se volvera a pedir nunca. */
  | 'saved'
  /** La API contesto, pero aun no hay once. Se reintenta en la siguiente pasada. */
  | 'not-published'
  /** Otra pasada la guardo entre la lectura y la escritura. Gana la primera. */
  | 'already-saved'
  /** La API fallo en este partido. El resto de la pasada sigue. */
  | 'failed'

export interface LineupOutcome {
  matchId: string
  /** 'ALA-GET', para leer el informe sin cruzar uuids. */
  pairing: string
  apiId: string
  status: LineupOutcomeStatus
  /** Cuantos titulares dio la API por lado. Con `not-published` explica por que. */
  starters: { home: number; away: number }
  note?: string
}

export interface LineupsSyncReport {
  ok: boolean
  /** `true` cuando el paso no se ejecuto: sin clave, sin partidos en ventana... */
  skipped: boolean
  error?: string
  /** `true` si el fallo es transitorio (429, 5xx, red) y merece reintento. */
  retryable?: boolean
  leagueId: string | null
  windowMinutes: number
  /** Partidos que arrancan dentro de la ventana y aun no tienen alineacion. */
  pending: number
  /** Alineaciones escritas en `match_lineups` en esta pasada. */
  saved: number
  requestsSpent: number
  requestsByKind: { matchesByDate: number; lineups: number }
  requestBudget: number
  outcomes: LineupOutcome[]
  /** Partidos nuestros que no casan con ninguno de la API. Nunca se inventan. */
  linkFailures: LinkFailure[]
  warnings: string[]
  durationMs: number
}

export interface LineupsSyncOptions {
  leagueId?: string
  /** Tope de peticiones de la pasada. Por defecto 12. */
  maxRequests?: number
  /** Ventana en minutos. Por defecto 90. Subirla multiplica el gasto diario. */
  windowMinutes?: number
}

/**
 * El cron no tiene sesion y `match_lineups` no tiene politica de escritura para
 * NADIE (ver 0013): escribe `service_role`, que es BYPASSRLS. La clave nunca
 * lleva prefijo `NEXT_PUBLIC_`.
 *
 * Es una copia de la de `events.ts` a proposito: son dos pasos independientes y
 * uno no puede quedarse sin cliente porque al otro le toquen los imports.
 */
function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Este paso escribe en ' +
        'match_lineups, que solo admite a service_role, asi que necesita la service role key.',
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

/** La tabla no existe todavia. Es un fallo de despliegue, no de la API. */
function isMissingTable(message: string): boolean {
  return /match_lineups/i.test(message) && /(does not exist|no existe|schema cache|42P01)/i.test(message)
}

function missingTableError(message: string): Error {
  return new Error(
    'Falta la tabla `public.match_lineups`. Aplica supabase/migrations/0013_lineups.sql: sin ella ' +
      'las alineaciones no se pueden guardar, y pedirlas a la API para no guardarlas seria tirar ' +
      `peticiones de las 100 que hay al dia. Detalle: ${message}`,
  )
}

/**
 * Lo que se guarda en `match_lineups.home` / `.away`. `position` va TAL CUAL lo
 * dio la API: la traduccion a 'GK'|'DEF'|'MID'|'FWD' se hace al leer, en
 * `src/lib/data/lineups.ts`, para que afinarla no obligue a volver a pedir nada.
 * `available` no se guarda: es `starters` + `substitutes` y se recalcula solo.
 */
function toStored(side: TeamLineup) {
  return {
    apiName: side.apiName,
    code: side.code,
    formation: side.formation,
    starters: side.starters,
    substitutes: side.substitutes,
  }
}

/**
 * Escribe la alineacion. Devuelve `false` si la fila ya existia: el `upsert` con
 * `ignoreDuplicates` es un `on conflict do nothing`, asi que la PRIMERA
 * alineacion guardada es la que manda y ni dos pasadas solapadas del cron ni una
 * fila puesta a mano (`source='admin'`) se pisan.
 */
async function saveLineups(
  admin: SupabaseClient,
  matchId: string,
  lineups: MatchLineups,
): Promise<boolean> {
  const { data, error } = await admin
    .from('match_lineups')
    .upsert(
      {
        match_id: matchId,
        home: toStored(lineups.home),
        away: toStored(lineups.away),
        fetched_at: new Date().toISOString(),
        source: 'api',
      },
      { onConflict: 'match_id', ignoreDuplicates: true },
    )
    .select('match_id')

  if (error) {
    throw isMissingTable(error.message)
      ? missingTableError(error.message)
      : new Error(`No se pudo guardar la alineacion de ${matchId}: ${error.message}`)
  }
  return (data ?? []).length > 0
}

/**
 * Trae las alineaciones de los partidos que arrancan YA y las guarda.
 *
 * QUE HACE, EN ORDEN
 *   1. partidos de la liga con `kickoff_at` entre AHORA y AHORA+90min;
 *   2. quita los que ya tienen fila en `match_lineups` -> esos no se piden JAMAS;
 *   3. lista los partidos de la API de ese dia (1 peticion por dia distinto);
 *   4. empareja con `linkMatches` (dia + local + visitante). El que no case NO se
 *      inventa: sale en `linkFailures` con los nombres literales de la API;
 *   5. pide `/lineups/{id}` por partido y guarda solo si los DOS equipos traen
 *      11 titulares o mas.
 *
 * PRESUPUESTO. Tope de 12 peticiones por pasada. Con el cron cada 15 minutos, un
 * partido tiene 6 oportunidades dentro de su ventana de 90 minutos. Una pasada
 * con partidos en ventana gasta 1 (listado del dia) + 1 por partido pendiente.
 * Como las alineaciones suelen publicarse sobre T-60, un partido se resuelve en
 * la tercera pasada: unas 6 peticiones por horario de partido (3 listados + 3
 * intentos). Un sabado con 4 horarios distintos son ~24 peticiones; una jornada
 * repartida de viernes a domingo, unas 50 en TRES dias distintos, con la cuota de
 * 100 contando por dia. Cabe, y ademas convive con el paso de goleadores (~14 por
 * jornada). Si un dia se fuera de madre: `?lineups=0` lo apaga y `?maxRequests=`
 * lo estrecha.
 *
 * OJO, LA CADENCIA DE HOY NO LLEGA. `.github/workflows/cron.yml` dispara cada 15
 * minutos SOLO `/api/push/dispatch`; a `/api/sync` lo llama una vez por hora
 * (cron '7 * * * *'). Con eso, la ventana de 90 minutos de un partido de las
 * 19:30 solo pilla las pasadas de las 18:07 y las 19:07: si la alineacion se
 * publica a las 19:15, NO se llega a pedir antes del pitido inicial. Para tener
 * las 6 oportunidades hay que llamar tambien a `/api/sync?squads=0&events=0` en
 * la pasada de cada 15 minutos, que fuera de ventana cuesta CERO peticiones de
 * Highlightly (la funcion sale antes de llamar a nadie). Ese fichero no es de
 * este lote y no se ha tocado.
 *
 * NUNCA LANZA: devuelve siempre un informe. Que falte la clave, que Highlightly
 * se caiga o que la tabla no este migrada no puede tumbar la ingesta de
 * football-data.org, que es la que sostiene el calendario.
 */
export async function syncLineups(options: LineupsSyncOptions = {}): Promise<LineupsSyncReport> {
  const startedAt = Date.now()
  const budgetLimit = Math.max(1, options.maxRequests ?? DEFAULT_MAX_REQUESTS)
  const budget = new RequestBudget(budgetLimit)
  const windowMinutes = Math.max(1, options.windowMinutes ?? WINDOW_MINUTES)
  const warnings: string[] = []
  const outcomes: LineupOutcome[] = []
  let requestsByDate = 0
  let requestsLineups = 0
  // Fuera del try: si la API falla, el informe tiene que seguir diciendo cuantos
  // partidos estaban pendientes. Es el numero con el que se decide si hay que
  // meter la alineacion a mano antes del pitido inicial.
  let pendingCount = 0

  const finish = (report: Partial<LineupsSyncReport>): LineupsSyncReport => ({
    ok: false,
    skipped: false,
    leagueId: null,
    windowMinutes,
    pending: pendingCount,
    saved: outcomes.filter((o) => o.status === 'saved').length,
    requestsSpent: budget.spent,
    requestsByKind: { matchesByDate: requestsByDate, lineups: requestsLineups },
    requestBudget: budgetLimit,
    outcomes,
    linkFailures: [],
    warnings,
    durationMs: Date.now() - startedAt,
    ...report,
  })

  // Sin clave el paso se SALTA con un aviso. No es un error: la app funciona sin
  // esto, simplemente la pantalla del partido dice "No disponible todavia".
  if (!isHighlightlyConfigured) {
    return finish({
      ok: true,
      skipped: true,
      error:
        'HIGHLIGHTLY_API_KEY no esta configurada: no se han traido alineaciones. La pantalla del ' +
        'partido seguira diciendo "No disponible todavia". El calendario, los horarios y los ' +
        'marcadores NO dependen de esta clave.',
    })
  }

  let leagueId: string | null = null
  let linkFailures: LinkFailure[] = []

  try {
    const admin = createAdminClient()
    leagueId = await resolveLeagueId(admin, options.leagueId)

    // ---- 1. Partidos que arrancan dentro de la ventana --------------------

    const { data: gameweeks, error: gwError } = await admin
      .from('gameweeks')
      .select('id')
      .eq('league_id', leagueId)
    if (gwError) throw new Error(`No se pudieron leer gameweeks: ${gwError.message}`)
    const gameweekIds = (gameweeks ?? []).map((row) => row.id as string)
    if (gameweekIds.length === 0) {
      return finish({ ok: true, skipped: true, leagueId, error: 'La liga no tiene jornadas todavia.' })
    }

    const now = Date.now()
    const { data: rows, error: matchError } = await admin
      .from('matches')
      .select('id, home_code, away_code, kickoff_at')
      .in('gameweek_id', gameweekIds)
      .gte('kickoff_at', new Date(now).toISOString())
      .lte('kickoff_at', new Date(now + windowMinutes * 60_000).toISOString())
      .order('kickoff_at', { ascending: true })
    if (matchError) throw new Error(`No se pudieron leer matches: ${matchError.message}`)

    const inWindow: LocalMatch[] = (rows ?? []).map((row) => ({
      id: row.id as string,
      homeCode: row.home_code as TeamCode,
      awayCode: row.away_code as TeamCode,
      kickoffAt: row.kickoff_at as string,
    }))

    if (inWindow.length === 0) {
      return finish({
        ok: true,
        skipped: true,
        leagueId,
        error: `Ningun partido arranca en los proximos ${windowMinutes} minutos. Cero peticiones gastadas.`,
      })
    }

    // ---- 2. Fuera los que ya tienen alineacion ----------------------------
    // ESTE FILTRO ES EL QUE AHORRA LA CUOTA: en cuanto un partido tiene fila, no
    // se vuelve a pedir NUNCA, ni en las 5 pasadas que quedan de su ventana.

    const { data: existing, error: existingError } = await admin
      .from('match_lineups')
      .select('match_id')
      .in(
        'match_id',
        inWindow.map((m) => m.id),
      )
    if (existingError) {
      throw isMissingTable(existingError.message)
        ? missingTableError(existingError.message)
        : new Error(`No se pudo leer match_lineups: ${existingError.message}`)
    }
    const done = new Set((existing ?? []).map((row) => row.match_id as string))
    const pending = inWindow.filter((m) => !done.has(m.id))
    pendingCount = pending.length

    if (pending.length === 0) {
      return finish({
        ok: true,
        skipped: true,
        leagueId,
        error:
          `Los ${inWindow.length} partido(s) de la ventana ya tienen alineacion guardada. ` +
          'Cero peticiones gastadas.',
      })
    }

    // ---- 3. Los partidos de la API, un dia por peticion --------------------

    const days = [...new Set(pending.map((m) => madridDate(m.kickoffAt)).filter((d): d is string => Boolean(d)))]
    const byDay = new Map<string, ResolvedApiMatch[]>()
    for (const day of days) {
      const list = await getMatchesByDate(day, { budget })
      requestsByDate += 1
      byDay.set(
        day,
        list.map(resolveApiMatch).filter((m): m is ResolvedApiMatch => m !== null),
      )
    }

    const link = linkMatches(pending, byDay)
    linkFailures = link.failures

    // ---- 4. Una peticion por partido, y solo se guarda el once completo ----

    for (const pair of link.linked) {
      const local = pair.local
      const pairing = `${local.homeCode}-${local.awayCode}`

      let lineups: MatchLineups
      try {
        lineups = await getLineups(pair.api.apiId, { budget })
        requestsLineups += 1
      } catch (error) {
        if (error instanceof BudgetExhaustedError) throw error
        if (error instanceof HighlightlyError && error.quotaExhausted) throw error
        outcomes.push({
          matchId: local.id,
          pairing,
          apiId: pair.api.apiId,
          status: 'failed',
          starters: { home: 0, away: 0 },
          note: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      const starters = { home: lineups.home.starters.length, away: lineups.away.starters.length }

      // AUN NO HA SALIDO. No se guarda NADA: una fila a medias se daria por buena
      // para siempre (el filtro del paso 2 es "hay fila", no "hay fila completa")
      // y la peña veria un campo con seis jugadores hasta el final del partido.
      if (starters.home < MIN_STARTERS || starters.away < MIN_STARTERS) {
        outcomes.push({
          matchId: local.id,
          pairing,
          apiId: pair.api.apiId,
          status: 'not-published',
          starters,
          note:
            `la API da ${starters.home} y ${starters.away} titulares (hacen falta ${MIN_STARTERS} y ` +
            `${MIN_STARTERS}). Todavia no ha salido: se reintenta en la siguiente pasada.`,
        })
        continue
      }

      const written = await saveLineups(admin, local.id, lineups)
      outcomes.push({
        matchId: local.id,
        pairing,
        apiId: pair.api.apiId,
        status: written ? 'saved' : 'already-saved',
        starters,
        note: written ? undefined : 'ya habia una alineacion guardada; gana la primera',
      })
    }

    if (linkFailures.length > 0) {
      warnings.push(
        `${linkFailures.length} partido(s) sin emparejar con Highlightly. NO se han inventado: ` +
          'mira `linkFailures[].apiTeamsThatDay` y completa HIGHLIGHTLY_TEAM_ALIASES en ' +
          'src/lib/highlightly/match-link.ts con el nombre literal que da la API.',
      )
    }

    return finish({ ok: true, leagueId, linkFailures })
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      // No es un fallo: se llego al tope de la pasada. Con el cron cada 15 minutos
      // quedan oportunidades dentro de la misma ventana de 90.
      warnings.push(error.message)
      return finish({ ok: true, leagueId, linkFailures })
    }
    const message = error instanceof Error ? error.message : String(error)
    const retryable = error instanceof HighlightlyError ? error.retryable : false
    return finish({ ok: false, leagueId, error: message, retryable, linkFailures })
  }
}
