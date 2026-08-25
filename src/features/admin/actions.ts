'use server'

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth'
import { madridWallToUtc, TEAM_CODES } from '@/lib/laliga'
import { normalizePlayer } from '@/lib/squads'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'
import type { Scoring, TeamCode } from '@/lib/types'

export type SaveState = { ok: boolean; error: string | null }

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Reglas de puntuacion, en el orden en que se pintan en el panel.
 * `assist` va detras de `scorer`: si falta, el jsonb que se escribe incumple
 * `leagues_scoring_shape` (0011) y el guardado revienta con 23514.
 */
const SCORING_KEYS = ['exact', 'x2', 'mvp', 'scorer', 'assist', 'pleno'] as const

const SCORING_MIN = 0
const SCORING_MAX = 20

const DENIED = 'No tienes permiso para tocar esto.'

/**
 * D5: solo `revalidatePath`. Guardar un resultado o cambiar la puntuacion
 * recalcula puntos, asi que hay que tirar la cache de las cuatro pantallas que
 * los muestran, no solo la del panel.
 */
function revalidateScoreboard() {
  revalidatePath('/ajustes/admin')
  revalidatePath('/jornada')
  revalidatePath('/clasificacion')
  revalidatePath('/perfil')
}

/**
 * Quien escribe y sobre que peña.
 *  - `dry`: no hay proyecto Supabase (arranque en seco). Se valida y no se persiste.
 *  - `db`: hay sesion y la liga que administra.
 *  - `denied`: no hay sesion o no administra ninguna liga.
 *
 * La frontera real es RLS (`leagues_update_admin`, `matches_write_admin`); esto
 * existe para dar un mensaje decente en vez de un rebote silencioso.
 */
type AdminContext =
  | { kind: 'dry' }
  | { kind: 'db'; supabase: Client; leagueId: string }
  | { kind: 'denied' }

async function adminContext(): Promise<AdminContext> {
  if (!isSupabaseConfigured) {
    try {
      await requireAdmin()
    } catch {
      return { kind: 'denied' }
    }
    return { kind: 'dry' }
  }

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const sub = data?.claims?.sub
  if (typeof sub !== 'string' || sub === '') return { kind: 'denied' }

  const { data: league } = await supabase
    .from('leagues')
    .select('id')
    .eq('admin_user_id', sub)
    .limit(1)
    .maybeSingle()

  if (!league) return { kind: 'denied' }
  return { kind: 'db', supabase, leagueId: league.id as string }
}

/**
 * Fila de resultado que envia `AdminResultForm`, ya serializada.
 * Marcador vacio ('') = partido sin resultado todavia; no es un error.
 */
type ResultInput = {
  id: string
  home: string
  away: string
  mvp: string
  scorers: string[]
  /** Lista aparte de `scorers`: el mismo jugador puede marcar y asistir. */
  assists: string[]
}

/** Un partido con mas de esto no es un partido, es un POST a pelo. */
const MAX_REAL_SCORERS = 20
const MAX_PLAYER_NAME = 40

/**
 * Recorta, colapsa espacios y tira vacios. NO deduplica.
 *
 * Deduplicaba por nombre normalizado, y eso hacia IMPOSIBLE anotar un doblete a
 * mano. `calc_points` cuenta las veces desde la migracion 0022 -- un goleador que
 * marca dos veces tiene que aparecer dos veces --, asi que el deduplicado se
 * comia justo el caso que hay que poder escribir.
 *
 * No es teoria: la ingesta tenia el mismo fallo y guardo el Elche 0-5 Barcelona
 * con 3 nombres para 5 goles (Raphinha 14' y 67', Fermin 71' y 79'). Al ir a
 * corregirlo desde aqui, esta funcion lo habria vuelto a colapsar.
 *
 * Repetir un nombre por error no rompe nada: `least(veces_puestas, veces_reales)`
 * no paga mas aciertos de los goles que hubo, y `MAX_REAL_SCORERS` sigue de tope.
 */
function tidyNames(raw: unknown[]): string[] | null {
  const out: string[] = []

  for (const value of raw) {
    if (typeof value !== 'string') return null
    const name = value.trim().replace(/\s+/g, ' ')
    if (name === '') continue
    if (name.length > MAX_PLAYER_NAME) return null
    if (normalizePlayer(name) === '') continue
    out.push(name)
  }

  return out
}

/**
 * Escribe el resultado real de los partidos ya jugados. El `requireAdmin()` /
 * `adminContext()` de aqui no es decorativo: una Server Action es un POST a la
 * ruta y el proxy no basta como autorizacion (D13).
 */
export async function saveMatchResultAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const context = await adminContext()
  if (context.kind === 'denied') return { ok: false, error: DENIED }

  let rows: ResultInput[]
  try {
    rows = JSON.parse(String(formData.get('results') ?? '[]')) as ResultInput[]
  } catch {
    return { ok: false, error: 'No hemos podido leer los resultados.' }
  }

  if (!Array.isArray(rows)) return { ok: false, error: 'No hemos podido leer los resultados.' }

  /** Solo se escriben los partidos con marcador completo: la constraint
   *  `matches_result_complete` exige marcador para `status = 'played'`. */
  const writable: Array<{
    id: string
    real_home: number
    real_away: number
    real_mvp: string | null
    real_scorers: string[]
    real_assists: string[]
  }> = []

  for (const row of rows) {
    const empty = row.home === '' && row.away === ''
    if (empty) continue

    const home = Number(row.home)
    const away = Number(row.away)
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      return { ok: false, error: 'Hay un marcador que no es un número válido.' }
    }
    if (row.home === '' || row.away === '') {
      return { ok: false, error: 'Falta un lado del marcador en algún partido.' }
    }
    // El check de `matches` topa los goles en 99; mejor decirlo aqui que rebotar.
    if (home > 99 || away > 99) {
      return { ok: false, error: 'Hay un marcador que no es un número válido.' }
    }

    const scorersRaw = Array.isArray(row.scorers) ? row.scorers : []
    if (scorersRaw.length > MAX_REAL_SCORERS) {
      return { ok: false, error: 'Hay demasiados goleadores en un partido.' }
    }
    const assistsRaw = Array.isArray(row.assists) ? row.assists : []
    if (assistsRaw.length > MAX_REAL_SCORERS) {
      return { ok: false, error: 'Hay demasiados asistentes en un partido.' }
    }
    const scorers = tidyNames(scorersRaw)
    const assists = tidyNames(assistsRaw)
    const mvp = tidyNames([row.mvp ?? ''])
    if (scorers === null || assists === null || mvp === null) {
      return { ok: false, error: 'Hay un nombre de jugador que no vale.' }
    }

    writable.push({
      id: String(row.id),
      real_home: home,
      real_away: away,
      real_mvp: mvp[0] ?? null,
      real_scorers: scorers,
      real_assists: assists,
    })
  }

  if (context.kind === 'db') {
    // Una escritura por partido: `upsert` no vale porque exigiria repetir
    // gameweek_id, equipos y kickoff, que el panel no envia ni debe tocar.
    // No es atomico entre partidos: si una falla, las anteriores quedan escritas
    // y el organizador ve el error y reintenta (la operacion es idempotente).
    for (const match of writable) {
      const { id, ...values } = match
      const { data, error } = await context.supabase
        .from('matches')
        .update({ ...values, status: 'played' })
        .eq('id', id)
        .select('id')

      if (error) return { ok: false, error: 'No hemos podido guardar los resultados.' }
      if (!data || data.length === 0) return { ok: false, error: DENIED }
    }
  }

  revalidateScoreboard()
  return { ok: true, error: null }
}

/**
 * Cambia la puntuacion de la peña. NO hay que recalcular nada a mano: los puntos
 * son vistas SQL sobre `leagues.scoring`, asi que toda la temporada se recalcula
 * sola. Lo unico que hay que tirar es la cache de las pantallas.
 */
export async function saveScoringAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const context = await adminContext()
  if (context.kind === 'denied') return { ok: false, error: DENIED }

  const scoring = {} as Scoring
  for (const key of SCORING_KEYS) {
    const value = Number(formData.get(key))
    if (!Number.isInteger(value) || value < SCORING_MIN || value > SCORING_MAX) {
      return { ok: false, error: 'Los puntos tienen que ir de 0 a 20.' }
    }
    scoring[key] = value
  }

  if (context.kind === 'db') {
    const { data, error } = await context.supabase
      .from('leagues')
      .update({ scoring })
      .eq('id', context.leagueId)
      .select('id')

    if (error) return { ok: false, error: 'No hemos podido guardar la puntuación.' }
    if (!data || data.length === 0) return { ok: false, error: DENIED }
  }

  revalidateScoreboard()
  return { ok: true, error: null }
}

/**
 * Fila de plantilla que envia `AdminSquadForm`, ya serializada.
 * Una plantilla vacia NO es un error: significa "este equipo se sigue escribiendo
 * a mano en el editor de pronostico".
 */
type SquadInput = { code: string; players: unknown }

/** Una plantilla de LaLiga no pasa de 30 y pico fichas; el tope solo frena abusos. */
const MAX_PLAYERS_PER_TEAM = 60

const VALID_CODES = new Set<string>(TEAM_CODES)

/**
 * Guarda las plantillas que corrige el organizador. Escribe siempre con
 * `source = 'admin'`, que es la marca que la ingesta de football-data.org
 * respeta: una fila corregida a mano no la pisa la API.
 *
 * Un equipo que llega vacio no se guarda vacio: se BORRA la correccion manual,
 * si la hay. Guardar `{}` con `source='admin'` congelaria ese equipo para
 * siempre (la ingesta no volveria a tocarlo), y el formulario envia los 20
 * equipos en cada guardado.
 */
export async function saveSquadsAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const context = await adminContext()
  if (context.kind === 'denied') return { ok: false, error: DENIED }

  let rows: SquadInput[]
  try {
    rows = JSON.parse(String(formData.get('squads') ?? '[]')) as SquadInput[]
  } catch {
    return { ok: false, error: 'No hemos podido leer las plantillas.' }
  }

  if (!Array.isArray(rows)) return { ok: false, error: 'No hemos podido leer las plantillas.' }

  const parsed: Array<{ code: TeamCode; players: string[] }> = []

  for (const row of rows) {
    if (!VALID_CODES.has(row?.code)) {
      return { ok: false, error: 'Hay un equipo que no es de esta temporada.' }
    }
    if (!Array.isArray(row.players)) {
      return { ok: false, error: 'Hay una plantilla que no hemos podido leer.' }
    }
    if (row.players.length > MAX_PLAYERS_PER_TEAM) {
      return { ok: false, error: `Ningún equipo puede pasar de ${MAX_PLAYERS_PER_TEAM} jugadores.` }
    }

    // Se revalida en servidor lo que el cliente ya hizo al escribir: recortar,
    // colapsar espacios y deduplicar por nombre normalizado. Un cliente puede
    // mandar lo que quiera, asi que la forma canonica se decide aqui.
    const players = tidyNames(row.players)
    if (players === null) return { ok: false, error: 'Hay un nombre de jugador que no vale.' }

    parsed.push({ code: row.code as TeamCode, players })
  }

  if (context.kind === 'db') {
    const now = new Date().toISOString()
    const upserts = parsed
      .filter((row) => row.players.length > 0)
      .map((row) => ({
        league_id: context.leagueId,
        team_code: row.code,
        players: row.players,
        source: 'admin',
        updated_at: now,
      }))

    if (upserts.length > 0) {
      const { error } = await context.supabase
        .from('team_squads')
        .upsert(upserts, { onConflict: 'league_id,team_code' })
      if (error) return { ok: false, error: squadWriteError(error) }
    }

    const emptied = parsed.filter((row) => row.players.length === 0).map((row) => row.code)
    if (emptied.length > 0) {
      // Solo se borra la correccion manual: si la fila venia de la API se deja
      // estar, para que vaciar el cuadro de texto no destruya datos de la ingesta.
      const { error } = await context.supabase
        .from('team_squads')
        .delete()
        .eq('league_id', context.leagueId)
        .eq('source', 'admin')
        .in('team_code', emptied)
      if (error) return { ok: false, error: squadWriteError(error) }
    }
  }

  // Las plantillas cambian los selectores de MVP y goleadores del editor, que
  // vive bajo /jornada, ademas del propio panel.
  revalidatePath('/ajustes/admin')
  revalidatePath('/jornada')
  return { ok: true, error: null }
}

/** PGRST205 = la tabla aun no esta en el esquema; no es culpa del organizador. */
function squadWriteError(error: { code?: string }): string {
  if (error.code === 'PGRST205') return 'Las plantillas todavía no están disponibles.'
  if (error.code === '42501') return DENIED
  return 'No hemos podido guardar las plantillas.'
}

/**
 * Fila que envia `AdminKickoffForm`.
 * `day`/`time` son hora de PARED de Madrid; `manual: false` devuelve el mando a
 * la API y entonces `day`/`time` sobran.
 */
type KickoffInput = { id: string; day: string; time: string; manual: boolean }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/**
 * Fija a mano la hora de un partido que aun no ha empezado, o devuelve el mando
 * a football-data.org.
 *
 * PARA QUE SIRVE
 * Cuando LaLiga aplaza un partido, la API tarda en enterarse (Celta-Osasuna, el
 * 14/08/2026: horas despues seguia dando la hora vieja). Como el cierre del
 * pronostico, el estado que se pinta y la RLS cuelgan los tres de `kickoff_at`,
 * esperar a la API significa que la peña no puede pronosticar un partido que no
 * se ha jugado y que ademas se le destapan los pronosticos a todo el mundo.
 *
 * LAS DOS PROTECCIONES VAN EN EL WHERE, NO EN MEMORIA
 * `gt('kickoff_at', ahora)` es lo que impide mover un partido ya empezado, y se
 * evalua en Postgres: entre leer y escribir cabe justo el instante del pitido
 * inicial. Si el UPDATE afecta a 0 filas, el partido arranco mientras se
 * guardaba, que es exactamente cuando NO hay que tocarlo. Mover hacia adelante
 * un partido empezado volveria a esconder pronosticos que la peña ya vio.
 * La segunda proteccion es RLS (`matches_write_admin`), que es la de verdad.
 */
export async function saveKickoffsAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const context = await adminContext()
  if (context.kind === 'denied') return { ok: false, error: DENIED }

  let rows: KickoffInput[]
  try {
    rows = JSON.parse(String(formData.get('kickoffs') ?? '[]')) as KickoffInput[]
  } catch {
    return { ok: false, error: 'No hemos podido leer los horarios.' }
  }
  if (!Array.isArray(rows)) return { ok: false, error: 'No hemos podido leer los horarios.' }

  const nowMs = Date.now()
  const fixed: Array<{ id: string; kickoffAt: string }> = []
  const released: string[] = []

  for (const row of rows) {
    const id = String(row?.id ?? '')
    if (id === '') return { ok: false, error: 'No hemos podido leer los horarios.' }

    if (!row.manual) {
      released.push(id)
      continue
    }

    if (!DAY_RE.test(String(row.day)) || !TIME_RE.test(String(row.time))) {
      return { ok: false, error: 'Hay una fecha u hora que no vale.' }
    }

    // La hora de pared la interpreta el SERVIDOR: el navegador puede tener otro
    // huso y de `kickoff_at` cuelga el cierre del pronostico.
    const kickoffAt = madridWallToUtc(row.day, row.time)
    const ms = Date.parse(kickoffAt)
    if (!Number.isFinite(ms)) return { ok: false, error: 'Hay una fecha u hora que no vale.' }

    // Poner una hora ya pasada sellaria el partido al instante y destaparia los
    // pronosticos de todos. Nunca es lo que se quiere.
    if (ms <= nowMs) return { ok: false, error: 'La hora nueva tiene que ser futura.' }

    fixed.push({ id, kickoffAt })
  }

  if (context.kind === 'db') {
    const nowIso = new Date(nowMs).toISOString()

    for (const match of fixed) {
      const { data, error } = await context.supabase
        .from('matches')
        .update({
          kickoff_at: match.kickoffAt,
          kickoff_source: 'admin',
          // Una hora puesta por el organizador es definitiva: fuera el
          // "Por confirmar" que pinta /jornada.
          kickoff_provisional: false,
        })
        .eq('id', match.id)
        .gt('kickoff_at', nowIso)
        .select('id')

      if (error) return { ok: false, error: kickoffWriteError(error) }
      if (!data || data.length === 0) {
        return { ok: false, error: 'Ese partido ya ha empezado: su hora no se puede mover.' }
      }
    }

    if (released.length > 0) {
      // Solo se suelta el mando: `kickoff_at` se deja como esta y la siguiente
      // pasada del cron trae la hora oficial. Escribir aqui una hora "de la API"
      // seria inventarla, porque en este momento no la tenemos.
      const { error } = await context.supabase
        .from('matches')
        .update({ kickoff_source: 'api' })
        .in('id', released)
        .eq('kickoff_source', 'admin')
      if (error) return { ok: false, error: kickoffWriteError(error) }
    }
  }

  // La hora cambia el orden y el contador de /jornada, y el estado del partido.
  revalidatePath('/ajustes/admin')
  revalidatePath('/jornada')
  revalidatePath('/clasificacion')
  return { ok: true, error: null }
}

function kickoffWriteError(error: { code?: string }): string {
  // 42703 / PGRST204 = falta la columna: la migracion 0016 no se ha aplicado.
  if (error.code === '42703' || error.code === 'PGRST204') {
    return 'Falta aplicar la migración 0016 en la base de datos.'
  }
  if (error.code === '42501') return DENIED
  return 'No hemos podido guardar los horarios.'
}
