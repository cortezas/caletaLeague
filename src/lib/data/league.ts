/**
 * Contexto de peticion, consultas base de la peña y los dos VM de ajustes.
 *
 * POR QUE ESTE FICHERO TIENE MAS DE LO QUE SU NOMBRE PROMETE
 * Las cuatro modulos de datos (`gameweek`, `standings`, `profile`, `squads`)
 * necesitan lo mismo antes de poder consultar nada: quien soy, en que peña
 * estoy, que puntuacion rige y en que instante se pinta todo. Ese contexto vive
 * aqui, y aqui viven tambien las consultas base (jornadas, partidos, plantillas)
 * porque `league.ts` es el unico modulo del que pueden colgar todos los demas
 * SIN crear un import circular: nada de aqui importa a los otros cuatro.
 *
 * LAS DOS FUENTES
 * Con Supabase configurado se consulta de verdad; sin el (`isSupabaseConfigured`
 * a false) cada funcion publica cae en `mock.ts` y la app arranca igual sin una
 * sola variable de entorno. La eleccion se toma UNA vez, en `getDataContext()`:
 * si devuelve `null` es que no hay backend y toca mock.
 *
 * SESION SIN PEÑA
 * Con Supabase configurado pero sin sesion (o con sesion que no es de ningun
 * miembro) NO se cae al mock: eso pintaria datos inventados a alguien que no ha
 * entrado. Se lanza `NoMemberError` y que la pantalla lo trate. La guarda de
 * verdad (redirigir a /login) es cosa de `requireMember()`, no de la capa de
 * datos.
 *
 * Riesgo Supabase: `getClaims()`, JAMAS `getSession()` en servidor.
 */

import { cache } from 'react'

import { TEAMS } from '../laliga'
import { createClient, isSupabaseConfigured } from '../supabase/server'
import { DEFAULT_SCORING } from '../types'
import type { MatchResult, MatchStatus, Scoring, TeamCode } from '../types'
import type {
  AdminGameweekVM,
  AdminMatchVM,
  AdminSquadVM,
  LeagueSettingsVM,
  TeamVM,
} from '../view-models'
import { mockGetActiveGameweek, mockGetGameweek, mockGetLeagueSettings } from './mock'

/* ------------------------------------------------------------------ *
 * 1. Contexto de la peticion
 * ------------------------------------------------------------------ */

/**
 * Hay backend, pero quien pregunta no puede ver datos.
 *
 * `reason` separa los dos casos porque la salida NO es la misma: sin sesion se
 * va a /login a pedir el enlace magico; con sesion pero sin ficha de miembro se
 * va a /onboarding a meter el codigo de la peña. Mandar a /login a quien ya ha
 * entrado lo dejaria en bucle.
 */
export type NoMemberReason = 'no-session' | 'no-member'

export class NoMemberError extends Error {
  readonly reason: NoMemberReason

  constructor(message: string, reason: NoMemberReason) {
    super(message)
    this.name = 'NoMemberError'
    this.reason = reason
  }
}

export type MemberInfo = {
  memberId: string
  userId: string
  displayName: string
  avatarColor: string; avatarUrl: string | null
}

export type DataContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  memberId: string
  leagueId: string
  leagueName: string
  inviteCode: string
  displayName: string
  avatarColor: string; avatarUrl: string | null
  isAdmin: boolean
  scoring: Scoring
  /** Los miembros de MI peña, por orden de alta. RLS ya recorta a mi liga. */
  members: MemberInfo[]
  /**
   * Instante unico para toda la peticion. Sin esto dos consultas de la misma
   * pantalla podrian caer a distinto lado del pitido inicial y la jornada
   * saldria incoherente consigo misma.
   */
  now: number
}

type LeagueEmbed = {
  id: string
  name: string
  invite_code: string
  scoring: unknown
  admin_user_id: string
}

type MemberRow = {
  id: string
  user_id: string
  league_id: string
  display_name: string
  avatar_color: string
  avatar_url: string | null
  leagues: LeagueEmbed
}

/**
 * Sin fila de miembro hay DOS casos que se ven igual desde aqui y que necesitan
 * salidas opuestas:
 *
 *   - de verdad no perteneces a ninguna peña  -> /onboarding, a meter el codigo;
 *   - la sesion no llega a la base de datos   -> /login, a volver a entrar.
 *
 * El segundo pasa cuando el token que viaja a PostgREST esta caducado o no
 * llega: el refresco vive en el proxy, y si falla (token rotado por otra
 * pestaña, la app abierta desde el viernes) `getClaims()` sigue devolviendo un
 * `sub` de la cookie pero `auth.uid()` es NULL. Con NULL la RLS de `members` no
 * devuelve ni una fila, exactamente igual que si no fueras miembro.
 *
 * Distinguirlos no es cosmetico: el fin de semana del 15-17/08/2026 esto dejo a
 * gente con ficha desde el dia 12 mirando la pantalla del codigo de invitacion,
 * que no arregla nada. Un callejon sin salida del que no se sale ni cerrando la
 * app.
 *
 * `current_uid()` (migracion 0020) pregunta quien eres PARA LA BASE. Solo se
 * llama aqui, en el camino de fallo, cuando ya ibamos a redirigir igualmente.
 */
async function missingMemberError(supabase: DataContext['supabase']): Promise<NoMemberError> {
  const { data, error } = await supabase.rpc('current_uid')

  // Si la propia comprobacion falla, se asume lo mas probable y lo menos dañino:
  // mandar a /login como mucho pide entrar otra vez; mandar a /onboarding a
  // quien ya es miembro no tiene salida.
  if (error || !data) {
    return new NoMemberError('Se ha caído la sesión. Vuelve a entrar.', 'no-session')
  }

  return new NoMemberError('Tu cuenta todavía no pertenece a ninguna peña.', 'no-member')
}

/** `leagues.scoring` es jsonb: puede venir con claves de menos o basura. */
function scoringOf(raw: unknown): Scoring {
  const src = (raw ?? {}) as Record<string, unknown>
  const value = (key: keyof Scoring) => {
    const n = src[key]
    return typeof n === 'number' && Number.isFinite(n) ? n : DEFAULT_SCORING[key]
  }
  return {
    exact: value('exact'),
    x2: value('x2'),
    mvp: value('mvp'),
    scorer: value('scorer'),
    // Una liga creada antes de 0011 no tiene la clave: cae al defecto (1 punto).
    assist: value('assist'),
    // Igual con el 0-0: una liga anterior a la 0032 no lo tiene y cae al defecto.
    goalless: value('goalless'),
    pleno: value('pleno'),
  }
}

/**
 * `null` = no hay Supabase configurado, hay que tirar de mock.
 * Lanza `NoMemberError` si hay backend pero no hay sesion o no hay ficha.
 *
 * `cache()` lo memoiza por peticion: las nueve funciones de datos comparten una
 * sola consulta de contexto y, sobre todo, el mismo `now`.
 */
export const getDataContext = cache(async (): Promise<DataContext | null> => {
  if (!isSupabaseConfigured) return null

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) throw new NoMemberError('No hay sesión iniciada.', 'no-session')

  // RLS ya limita `members` a las peñas del usuario, asi que esta consulta trae
  // a los 12 de la peña y no hace falta filtrar por liga a mano.
  const { data, error } = await supabase
    .from('members')
    .select(
      'id, user_id, league_id, display_name, avatar_color, avatar_url, ' +
        'leagues!inner(id, name, invite_code, scoring, admin_user_id)',
    )
    .order('joined_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as unknown as MemberRow[]
  const mine = rows.find((row) => row.user_id === userId)
  if (!mine) throw await missingMemberError(supabase)

  const league = mine.leagues

  return {
    supabase,
    userId,
    memberId: mine.id,
    leagueId: mine.league_id,
    leagueName: league.name,
    inviteCode: league.invite_code,
    displayName: mine.display_name,
    avatarColor: mine.avatar_color,
      avatarUrl: mine.avatar_url,
    isAdmin: league.admin_user_id === userId,
    scoring: scoringOf(league.scoring),
    members: rows
      .filter((row) => row.league_id === mine.league_id)
      .map((row) => ({
        memberId: row.id,
        userId: row.user_id,
        displayName: row.display_name,
        avatarColor: row.avatar_color,
      avatarUrl: row.avatar_url,
      })),
    now: Date.now(),
  }
})

/* ------------------------------------------------------------------ *
 * 2. Consultas base: jornadas, partidos y plantillas
 * ------------------------------------------------------------------ */

export type GameweekRow = { id: string; number: number; opens_at: string }

export type MatchRow = {
  id: string
  gameweek_id: string
  home_code: TeamCode
  away_code: TeamCode
  kickoff_at: string
  kickoff_provisional: boolean
  status: MatchStatus
  real_home: number | null
  real_away: number | null
  real_mvp: string | null
  real_scorers: string[] | null
  real_assists: string[] | null
  position: number
  /** 'admin' = la hora la fijo el organizador; la ingesta no la pisa (0016). */
  kickoff_source: string | null
  kickoff_api_at: string | null
  /** Partido estrella: 2 = vale doble (migracion 0034). */
  multiplicador: number | null
}

// `real_assists` va SIEMPRE en el select. Si falta, `resultOf` monta un
// MatchResult sin `assists` y el primer `.map()` de la pantalla revienta.
const MATCH_COLUMNS =
  'id, gameweek_id, home_code, away_code, kickoff_at, kickoff_provisional, ' +
  'status, real_home, real_away, real_mvp, real_scorers, real_assists, position, kickoff_source, ' +
  'kickoff_api_at, multiplicador'

export const getLeagueGameweeks = cache(async (): Promise<GameweekRow[]> => {
  const ctx = await getDataContext()
  if (!ctx) return []

  const { data, error } = await ctx.supabase
    .from('gameweeks')
    .select('id, number, opens_at')
    .eq('league_id', ctx.leagueId)
    .order('number', { ascending: true })
  if (error) throw error

  return (data ?? []) as unknown as GameweekRow[]
})

/**
 * Los partidos de una jornada, ORDENADOS POR HORA y no por `position`.
 * `position` es el orden del sorteo, y con los aplazamientos del Mundial deja de
 * coincidir con el orden en que se juegan: la jornada 1 empieza por Alavés–Getafe
 * (15 de agosto) y acaba en Barcelona–Athletic (27), que salio tercero en el
 * sorteo. La lista de la pantalla se lee por fecha.
 */
export async function fetchMatchRows(ctx: DataContext, gameweekId: string): Promise<MatchRow[]> {
  const { data, error } = await ctx.supabase
    .from('matches')
    .select(MATCH_COLUMNS)
    .eq('gameweek_id', gameweekId)
    .order('kickoff_at', { ascending: true })
    .order('position', { ascending: true })
  if (error) throw error

  return (data ?? []) as unknown as MatchRow[]
}

/** Un partido suelto. `null` si no existe o si RLS no lo deja ver. */
export async function fetchMatchRow(ctx: DataContext, matchId: string): Promise<MatchRow | null> {
  // Un id que no es uuid (por ejemplo el `2026-27-J01-M03` del mock) haria que
  // Postgres devolviera un error de sintaxis en vez de "no existe". La pantalla
  // espera `null` para hacer notFound(), asi que se filtra antes de preguntar.
  if (!isUuid(matchId)) return null

  const { data, error } = await ctx.supabase
    .from('matches')
    .select(MATCH_COLUMNS)
    .eq('id', matchId)
    .maybeSingle()
  if (error) throw error

  return (data ?? null) as unknown as MatchRow | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * La jornada por defecto: la que contiene el partido ABIERTO (pitido inicial
 * todavia en el futuro) mas proximo. O sea, la que se CIERRA antes.
 *
 * POR QUE NO VALE "la primera por numero que aun tiene partidos pendientes"
 * Los aplazamientos del Mundial 2026 han metido la jornada 2 DENTRO de la 1: la
 * 1 va del 15 al 27 de agosto y la 2, entera, del 20 al 24. Con el criterio
 * viejo el 21 de agosto salia la 1 (le quedaba el partido del 25) y la 2 no se
 * podia pronosticar NUNCA: cuando la 1 terminaba, la 2 ya se habia jugado.
 * Con este criterio el 21 de agosto sale la 2, cuyo siguiente partido abierto
 * es el del 23, antes que el del 25 de la 1. Y el 26, con la 2 ya jugada,
 * vuelve a salir la 1, que aun tiene el partido del 27.
 *
 * `> now` y no `>=`: un partido que arranca justo en este instante ya esta
 * sellado, y asi lo ven tanto `effectiveStatus` como la politica RLS.
 *
 * Empate exacto de kickoff entre dos jornadas: gana la de numero menor, para
 * que el resultado no dependa del orden en que lleguen las filas.
 *
 * Sin ningun partido abierto (temporada terminada) devuelve la ULTIMA jornada
 * CON PARTIDOS, que es la que queda por repasar.
 *
 * Pura a proposito: es la unica logica delicada de este fichero y asi se puede
 * comprobar contra el calendario real sin levantar Supabase.
 */
export function pickDefaultGameweek(
  gameweeks: GameweekRow[],
  matches: Array<{ gameweek_id: string; kickoff_at: string }>,
  now: number,
): GameweekRow | null {
  if (gameweeks.length === 0) return null

  const byId = new Map(gameweeks.map((gw) => [gw.id, gw]))

  let nextOpen: { gw: GameweekRow; at: number } | null = null
  let lastWithMatches: GameweekRow | null = null

  for (const row of matches) {
    // Un partido de otra liga no deberia llegar hasta aqui (RLS y el filtro por
    // league_id lo cortan), pero si llega no puede mandar sobre mi jornada.
    const gw = byId.get(row.gameweek_id)
    if (!gw) continue

    if (!lastWithMatches || gw.number > lastWithMatches.number) lastWithMatches = gw

    const at = Date.parse(row.kickoff_at)
    if (!Number.isFinite(at) || at <= now) continue

    const better =
      !nextOpen || at < nextOpen.at || (at === nextOpen.at && gw.number < nextOpen.gw.number)
    if (better) nextOpen = { gw, at }
  }

  // El ultimo respaldo es para una liga con jornadas sembradas y ni un partido.
  return nextOpen?.gw ?? lastWithMatches ?? gameweeks[gameweeks.length - 1]
}

/** La jornada por defecto de MI liga. Ver `pickDefaultGameweek` para el criterio. */
export const resolveActiveGameweek = cache(async (): Promise<GameweekRow | null> => {
  const ctx = await getDataContext()
  if (!ctx) return null

  const gameweeks = await getLeagueGameweeks()
  if (gameweeks.length === 0) return null

  // Sin filtro por fecha: hace falta el calendario entero para poder caer en la
  // ultima jornada con partidos cuando ya no queda ninguno abierto.
  const { data, error } = await ctx.supabase
    .from('matches')
    .select('gameweek_id, kickoff_at, gameweeks!inner(league_id)')
    .eq('gameweeks.league_id', ctx.leagueId)
  if (error) throw error

  const rows = (data ?? []) as unknown as Array<{ gameweek_id: string; kickoff_at: string }>
  return pickDefaultGameweek(gameweeks, rows, ctx.now)
})

/** Ids de jornada con al menos un partido jugado. Base de "temporada en curso". */
export const getPlayedGameweekIds = cache(async (): Promise<Set<string>> => {
  const ctx = await getDataContext()
  if (!ctx) return new Set()

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('gameweek_id, gameweeks!inner(league_id)')
    .eq('gameweeks.league_id', ctx.leagueId)
    .eq('status', 'played')
  if (error) throw error

  return new Set(
    ((data ?? []) as unknown as Array<{ gameweek_id: string }>).map((row) => row.gameweek_id),
  )
})

/** Plantillas de la peña, por codigo de equipo. Un equipo sin fila no es un error. */
export const getLeagueSquads = cache(async (): Promise<Map<TeamCode, string[]>> => {
  const ctx = await getDataContext()
  if (!ctx) return new Map()

  const { data, error } = await ctx.supabase
    .from('team_squads')
    .select('team_code, players')
    .eq('league_id', ctx.leagueId)
  if (error) throw error

  const rows = (data ?? []) as unknown as Array<{ team_code: TeamCode; players: string[] | null }>
  return new Map(rows.map((row) => [row.team_code, row.players ?? []]))
})

/**
 * Lo mismo que `getLeagueSquads` pero SIN tirar el `source`, que es lo unico
 * que distingue "De la API" de "Corregida a mano" en el panel de organizador.
 * Solo la usa `/ajustes/admin`; las pantallas de la peña solo quieren nombres.
 */
export const getAdminSquads = cache(async (): Promise<AdminSquadVM[]> => {
  const ctx = await getDataContext()
  if (!ctx) return []

  const { data, error } = await ctx.supabase
    .from('team_squads')
    .select('team_code, players, source')
    .eq('league_id', ctx.leagueId)
  if (error) throw error

  const rows = (data ?? []) as unknown as Array<{
    team_code: TeamCode
    players: string[] | null
    source: string
  }>

  return rows.map((row) => ({
    code: row.team_code,
    players: row.players ?? [],
    // El check de la tabla ya solo admite 'api' | 'admin'; el ternario existe
    // para estrechar el tipo, no porque pueda llegar otra cosa.
    source: row.source === 'admin' ? 'admin' : 'api',
  }))
})

/* ------------------------------------------------------------------ *
 * 3. Helpers de partido compartidos
 * ------------------------------------------------------------------ */

/**
 * Lo minimo para saber el estado: asi lo puede llamar tambien la consulta
 * recortada del panel de organizador, que no trae la fila entera.
 */
type StatusInput = Pick<MatchRow, 'status' | 'kickoff_at'>

/**
 * El estado que se pinta.
 *
 * `matches.status` esta materializado y lo mueve la ingesta o el admin, asi que
 * puede ir por detras del reloj: un partido sigue en 'open' hasta que alguien
 * llama a `refresh_match_statuses()`. RLS, en cambio, cuelga SOLO de
 * `kickoff_at`, y ya ha sellado el pronostico. Ensenar 'open' ahi seria mentir e
 * invitar a un guardado que la base va a rechazar, asi que pasado el pitido
 * inicial se degrada a 'locked'.
 *
 * 'live' y 'played' no se tocan: esos SI son informacion que solo tiene la
 * ingesta y que el reloj no puede deducir.
 */
export function effectiveStatus(row: StatusInput, now: number): MatchStatus {
  if (row.status === 'live' || row.status === 'played') return row.status
  return Date.parse(row.kickoff_at) > now ? 'open' : 'locked'
}

/**
 * Lo que el organizador tiene PENDIENTE de rellenar en un partido. La regla vive
 * aqui una sola vez y se llama con el estado ya calculado, tanto desde la fila
 * cruda (para elegir jornada) como desde el VM ya montado (para contar).
 *
 *  - 'played' sin MVP: el marcador lo trae la API y `matches_result_complete`
 *    garantiza que un partido jugado SIEMPRE tiene marcador, pero el MVP, los
 *    goleadores y los asistentes los mete el organizador a mano.
 *  - 'locked': el pitido inicial ya paso y en la base no hay resultado ninguno,
 *    o sea que la ingesta aun no lo ha traido. Tambien es cosa suya.
 *
 * 'live' NO cuenta: el partido se esta jugando y todavia no hay nada que meter.
 */
export function isMatchPending(status: MatchStatus, mvp: string | null): boolean {
  if (status === 'played') return (mvp ?? '').trim() === ''
  return status === 'locked'
}

/** Resultado real, o `null` si el partido no esta jugado. */
export function resultOf(row: MatchRow, now: number): MatchResult | null {
  if (effectiveStatus(row, now) !== 'played') return null
  if (row.real_home === null || row.real_away === null) return null
  return {
    home: row.real_home,
    away: row.real_away,
    // El MVP lo mete el organizador DESPUES del partido: que falte es lo normal
    // recien acabado, no un error. La UI lo pinta como "Falta el MVP".
    mvp: row.real_mvp ?? '',
    scorers: row.real_scorers ?? [],
    // Igual que los goleadores: los mete el organizador y pueden faltar. Lista
    // aparte, no pareja de cada gol.
    assists: row.real_assists ?? [],
  }
}

/**
 * Marcador EN CURSO: el partido ya empezo y todavia no esta cerrado.
 *
 * Sale de las mismas dos columnas que el resultado final. La ingesta las escribe
 * en cada pasada tambien mientras se juega, porque football-data manda el
 * marcador del momento en `score.fullTime` cuando el estado es IN_PLAY. O sea
 * que el dato ya estaba en la base y no se pintaba en ningun sitio.
 *
 * `null` si el partido no ha empezado o si aun no hay marcador que enseñar.
 */
export function liveScoreOf(row: MatchRow, now: number): { home: number; away: number } | null {
  const status = effectiveStatus(row, now)
  if (status === 'open' || status === 'played') return null
  if (row.real_home === null || row.real_away === null) return null
  return { home: row.real_home, away: row.real_away }
}

/**
 * Como `resultOf`, pero tambien durante el partido.
 *
 * `resultOf` solo contesta con el partido CERRADO, y eso es lo correcto para la
 * clasificacion: un marcador a medias no es un resultado. Pero el pique si tiene
 * que enseñar lo que va habiendo, que es justo el rato en que la peña lo mira.
 *
 * Lo que devuelve es provisional y quien lo pinta tiene que decirlo. Los
 * goleadores pueden ir por detras del marcador: Highlightly no publica al mismo
 * ritmo que football-data.
 */
export function resultOrLiveOf(row: MatchRow, now: number): MatchResult | null {
  if (effectiveStatus(row, now) === 'open') return null
  if (row.real_home === null || row.real_away === null) return null
  return {
    home: row.real_home,
    away: row.real_away,
    mvp: row.real_mvp ?? '',
    scorers: row.real_scorers ?? [],
    assists: row.real_assists ?? [],
  }
}

/**
 * Ficha visual del equipo. Un codigo que no este en `TEAMS` (un ascendido que
 * aun no se ha añadido a laliga.ts, por ejemplo) NO revienta la pantalla: se
 * pinta con sus siglas y un gris neutro, y se ve a la legua que falta el dato.
 */
export function teamVM(code: TeamCode): TeamVM {
  const team = TEAMS[code]
  if (!team) return { code, name: code, color: '#2A2F3A', ink: '#FFFFFF' }
  return { code, name: team.name, color: team.color, ink: team.ink }
}

/** 'Sevilla – Valencia' (guion largo con espacios, como el prototipo). */
export function matchLabel(row: MatchRow): string {
  return `${teamVM(row.home_code).name} – ${teamVM(row.away_code).name}`
}

/** PostgREST devuelve `+00:00`; el VM promete ISO 8601 en UTC con `Z`. */
export function isoUtc(timestamp: string): string {
  return new Date(timestamp).toISOString()
}

/* ------------------------------------------------------------------ *
 * 4. Las dos funciones publicas de este modulo
 * ------------------------------------------------------------------ */

export async function getLeagueSettings(): Promise<LeagueSettingsVM> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetLeagueSettings()

  return {
    leagueName: ctx.leagueName,
    inviteCode: ctx.inviteCode,
    memberCount: ctx.members.length,
    isAdmin: ctx.isAdmin,
    scoring: ctx.scoring,
    displayName: ctx.displayName,
    avatarColor: ctx.avatarColor,
    avatarUrl: ctx.avatarUrl,
  }
}

/** Una peña sin calendario sembrado. El panel abre igual: hay dos pestañas mas. */
const EMPTY_ADMIN_GAMEWEEK: AdminGameweekVM = {
  id: '',
  number: 0,
  matches: [],
  hasPrev: false,
  hasNext: false,
  prevNumber: null,
  nextNumber: null,
  isDefault: true,
  pendingCount: 0,
}

type AdminNav = Pick<AdminGameweekVM, 'hasPrev' | 'hasNext' | 'prevNumber' | 'nextNumber'>

/**
 * Las vecinas dentro de las jornadas que SI existen en la liga. Nada de 1 y 38
 * cableados, igual que en `/jornada`: una peña con medio calendario sembrado
 * tendria flechas que no llevan a ninguna parte.
 */
function navOf(gameweeks: GameweekRow[], index: number): AdminNav {
  const prev = index > 0 ? gameweeks[index - 1] : null
  const next = index >= 0 && index < gameweeks.length - 1 ? gameweeks[index + 1] : null
  return {
    hasPrev: prev !== null,
    hasNext: next !== null,
    prevNumber: prev?.number ?? null,
    nextNumber: next?.number ?? null,
  }
}

/**
 * La jornada por defecto DEL PANEL: la mas antigua que tenga algo pendiente de
 * rellenar (ver `isMatchPending`). `null` si no hay ninguna.
 *
 * POR QUE NO VALE `pickDefaultGameweek`
 * Esa elige la que se CIERRA antes, que es lo que quiere quien pronostica: lo
 * que viene. El organizador quiere lo contrario, lo que ya paso y le falta por
 * meter. El 21 de agosto la de cierre mas proximo es la 2 (se juega entera del
 * 20 al 24, dentro de la 1) y el organizador estaria mirando partidos sin jugar
 * mientras la 1, jugada el 15 y el 16, sigue esperando su MVP.
 *
 * Pura a proposito, igual que `pickDefaultGameweek`: se puede comprobar contra
 * el calendario real sin levantar Supabase.
 */
export function pickAdminGameweek(
  gameweeks: GameweekRow[],
  matches: Array<StatusInput & { gameweek_id: string; real_mvp: string | null }>,
  now: number,
): GameweekRow | null {
  const byId = new Map(gameweeks.map((gw) => [gw.id, gw]))

  let oldest: GameweekRow | null = null
  for (const row of matches) {
    const gw = byId.get(row.gameweek_id)
    if (!gw) continue
    if (!isMatchPending(effectiveStatus(row, now), row.real_mvp)) continue
    if (!oldest || gw.number < oldest.number) oldest = gw
  }

  return oldest
}

/** La jornada pendiente de MI liga. Ver `pickAdminGameweek` para el criterio. */
export const resolveAdminGameweek = cache(async (): Promise<GameweekRow | null> => {
  const ctx = await getDataContext()
  if (!ctx) return null

  const gameweeks = await getLeagueGameweeks()
  if (gameweeks.length === 0) return null

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('gameweek_id, kickoff_at, status, real_mvp, gameweeks!inner(league_id)')
    .eq('gameweeks.league_id', ctx.leagueId)
  if (error) throw error

  const rows = (data ?? []) as unknown as Array<
    StatusInput & { gameweek_id: string; real_mvp: string | null }
  >
  return pickAdminGameweek(gameweeks, rows, ctx.now)
})

/** Lo mismo que `isMatchPending`, pero sobre el VM ya montado. */
function pendingCountOf(matches: AdminMatchVM[]): number {
  return matches.filter((match) => isMatchPending(match.status, match.result?.mvp ?? null)).length
}

/**
 * Los partidos que el organizador rellena, con su navegacion de jornadas.
 *
 * Con numero, esa jornada; `null` si no existe en la liga y la pantalla hace
 * `notFound()`. Sin numero, la jornada PENDIENTE (`pickAdminGameweek`) y, si no
 * hay ninguna pendiente, la de siempre: la que se cierra antes.
 */
export async function getAdminMatches(n?: number): Promise<AdminGameweekVM | null> {
  const ctx = await getDataContext()
  if (!ctx) return mockAdminGameweek(n)

  const gameweeks = await getLeagueGameweeks()
  // La pendiente manda; sin nada pendiente se cae al criterio normal.
  const fallback = (await resolveAdminGameweek()) ?? (await resolveActiveGameweek())

  const index =
    n === undefined
      ? gameweeks.findIndex((gw) => gw.id === fallback?.id)
      : gameweeks.findIndex((gw) => gw.number === n)
  // Sin numero y sin jornada que elegir es que la peña no tiene calendario: eso
  // no es un 404, es una pantalla vacia. Con numero si: ese `?j=` no existe.
  if (index === -1) return n === undefined ? EMPTY_ADMIN_GAMEWEEK : null

  const gameweek = gameweeks[index]
  const [rows, squads] = await Promise.all([fetchMatchRows(ctx, gameweek.id), getLeagueSquads()])

  const matches: AdminMatchVM[] = rows.map((row) => {
    const status = effectiveStatus(row, ctx.now)
    const result = resultOf(row, ctx.now)
    return {
      id: row.id,
      label: matchLabel(row),
      status,
      result,
      missingMvp: status === 'played' && !result?.mvp,
      players: [...(squads.get(row.home_code) ?? []), ...(squads.get(row.away_code) ?? [])],
      kickoffAt: row.kickoff_at,
      kickoffManual: row.kickoff_source === 'admin',
      apiKickoffAt: row.kickoff_api_at,
      multiplier: row.multiplicador ?? 1,
    }
  })

  return {
    id: gameweek.id,
    number: gameweek.number,
    matches,
    ...navOf(gameweeks, index),
    isDefault: fallback?.id === gameweek.id,
    pendingCount: pendingCountOf(matches),
  }
}

/**
 * El panel sin backend. Los partidos salen del mismo VM de jornada que usa
 * /jornada para que el `?j=` tambien funcione en seco; `players` va vacio porque
 * sin base de datos `squadOf()` no tiene plantillas que dar (ver `lib/squads.ts`).
 */
async function mockAdminGameweek(n?: number): Promise<AdminGameweekVM | null> {
  const gameweek = n === undefined ? await mockGetActiveGameweek() : await mockGetGameweek(n)
  if (!gameweek) return null

  const matches: AdminMatchVM[] = gameweek.matches.map((row) => ({
    id: row.id,
    label: `${row.home.name} – ${row.away.name}`,
    status: row.status,
    result: row.result,
    multiplier: row.multiplier,
    missingMvp: row.status === 'played' && !row.result?.mvp,
    players: [],
    kickoffAt: row.kickoffAt,
    // Sin base de datos no hay columna que consultar: en seco nada es manual.
    kickoffManual: false,
    apiKickoffAt: null,
  }))

  return {
    // En seco no hay id de jornada que valga; el formulario del partido estrella
    // se apaga solo porque la accion pide uno.
    id: '',
    number: gameweek.number,
    matches,
    hasPrev: gameweek.hasPrev,
    hasNext: gameweek.hasNext,
    prevNumber: gameweek.prevNumber,
    nextNumber: gameweek.nextNumber,
    isDefault: gameweek.isDefault,
    pendingCount: pendingCountOf(matches),
  }
}
