/**
 * Goleadores y asistencias: Highlightly -> `matches.real_scorers` / `real_assists`.
 *
 * Con esto el organizador deja de teclear goleadores y asistentes despues de
 * cada partido. Le queda SOLO el MVP, que no lo da ninguna API porque es un
 * invento de la peña.
 *
 * CUATRO INVARIANTES QUE NO SE NEGOCIAN
 *
 * 1. **Lo manual manda.** Si el organizador ya escribio goleadores o asistentes,
 *    la ingesta NO los toca. El guardia son las tres condiciones del WHERE que
 *    documenta la migracion 0012, evaluadas por Postgres y no por memoria del
 *    proceso: entre leer y escribir cabe justo el instante en que el organizador
 *    da a guardar.
 *
 * 2. **Nunca revienta.** Devuelve siempre un informe; los fallos van dentro. Que
 *    Highlightly se caiga, que falte la clave o que cambien los nombres de los
 *    equipos NO puede tumbar la ingesta de football-data.org, que es la que
 *    sostiene el calendario y sin la cual no se puede ni jugar.
 *
 * 3. **Un partido que no case NO se inventa.** Ni el emparejamiento (ver
 *    `match-link.ts`) ni los nombres. Un nombre de jugador que no case con la
 *    plantilla se guarda ABREVIADO, tal cual lo dio la API: mejor "A. Perez" que
 *    el jugador equivocado. El nombre equivocado reparte puntos que no son.
 *
 * 4. **Una peticion por partido, y ni una mas.** Cuota: 100 AL DIA. Un partido
 *    ya resuelto no se vuelve a consultar NUNCA, ni siquiera cuando acabo 0-0
 *    (por eso el 0-0 se cierra marcando `real_players_source = 'api'`).
 *
 * SOLO SERVIDOR: usa la service role key, que se salta RLS. Nunca importar esto
 * desde un Client Component.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { normalizePlayer } from '@/lib/squads'
import type { TeamCode } from '@/lib/types'
import {
  BudgetExhaustedError,
  HighlightlyError,
  RequestBudget,
  getMatchEvents,
  getMatchesByDate,
  isHighlightlyConfigured,
} from './client'
import {
  linkMatches,
  madridDate,
  resolveApiMatch,
  resolveHighlightlyTeam,
  teamName,
  type LinkFailure,
  type LocalMatch,
  type ResolvedApiMatch,
} from './match-link'
import type { HlEvent } from './types'

// ---------------------------------------------------------------------------
// Nombres: de "A. Perez" a "Ayoze Pérez"
// ---------------------------------------------------------------------------

/**
 * Como se guarda un nombre y por que.
 *
 * `matched: false` NO es un fallo: significa que se guarda el nombre tal cual lo
 * dio la API. `calc_points` compara con `norm_player`, asi que un abreviado
 * simplemente no puntuara a nadie... que es correcto, porque tampoco sabemos a
 * quien deberia puntuar.
 */
export interface NameResolution {
  /** Lo que dijo la API. */
  input: string
  /** Lo que se guarda en la base. */
  resolved: string
  matched: boolean
  reason:
    | 'exact'
    | 'initial-surname'
    | 'surname'
    | 'given-name'
    | 'ambiguous'
    | 'no-squad'
    | 'no-match'
  /** Solo cuando `reason === 'ambiguous'`: a quienes podria referirse. */
  candidates?: string[]
}

/**
 * Apellidos candidatos de un nombre completo: todos los sufijos menos el nombre
 * entero. "Alvaro Garcia Rivera" -> ["garcia rivera", "rivera"].
 *
 * Hacen falta los sufijos y no solo la ultima palabra porque los apellidos
 * compuestos son la norma aqui y la API abrevia unas veces por el primero y
 * otras por los dos. Un nombre de una sola palabra se devuelve el mismo: hay
 * futbolistas que se llaman asi y tienen el mismo derecho a casar.
 */
function surnameVariants(normalized: string): string[] {
  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length <= 1) return tokens
  const out: string[] = []
  for (let i = 1; i < tokens.length; i += 1) out.push(tokens.slice(i).join(' '))
  return out
}

/** Primera letra del nombre de pila. `''` si el nombre viene vacio. */
function firstInitial(normalized: string): string {
  return normalized.slice(0, 1)
}

/**
 * Separa un nombre abreviado: "a. perez" o "a perez" -> `{ initial: 'a', surname: 'perez' }`.
 * `null` si no tiene esa forma.
 *
 * `normalizePlayer` NO quita los puntos, asi que el punto sigue ahi y se
 * contempla de forma explicita.
 */
function splitAbbreviated(normalized: string): { initial: string; surname: string } | null {
  const match = /^([a-z])\.?\s+(.+)$/.exec(normalized)
  if (!match) return null
  return { initial: match[1], surname: match[2].replace(/^\.\s*/, '').trim() }
}

/**
 * Empareja un nombre de evento contra la plantilla del equipo.
 *
 * Los eventos llegan ABREVIADOS ("A. Perez", "N. Pepe") y las plantillas de
 * `team_squads` completas ("Ayoze Pérez", "Nicolas Pépé"). Todo se compara con
 * `normalizePlayer` de `@/lib/squads`, la MISMA funcion con la que despues
 * puntua `scoreMatch()` y su espejo SQL `norm_player`: si aqui se comparase de
 * otra forma, se guardarian nombres que el calculo de puntos no reconoce.
 *
 * Escalera, y para en el primer escalon que da un candidato UNICO:
 *   1. igualdad exacta normalizada;
 *   2. inicial + apellido (la forma en que abrevia la API);
 *   3. solo apellido, si en toda la plantilla lo lleva una unica persona;
 *   4. una sola palabra contra el NOMBRE DE PILA, si es unico en la plantilla.
 *      Este ultimo escalon existe por los brasilenos: la API escribe "Vinicius"
 *      y la plantilla dice "Vinicius Junior". Es seguro porque exige unicidad:
 *      "Marc" en el Barcelona da dos candidatos (Casado y Bernal) y se queda sin
 *      resolver, que es lo correcto.
 *
 * Dos candidatos es AMBIGUO y se queda el nombre crudo. Dos "Garcia" en la misma
 * plantilla no son un caso raro, son un martes cualquiera.
 */
export function resolvePlayerName(raw: string, squad: string[]): NameResolution {
  const input = raw.trim()
  const norm = normalizePlayer(input)
  if (norm === '') {
    return { input, resolved: input, matched: false, reason: 'no-match' }
  }
  if (squad.length === 0) {
    // Sin plantilla no hay contra que comparar. No es un fallo del emparejador:
    // es que football-data.org no trajo la plantilla de ese equipo.
    return { input, resolved: input, matched: false, reason: 'no-squad' }
  }

  const entries = squad
    .map((name) => ({ name, norm: normalizePlayer(name) }))
    .filter((entry) => entry.norm !== '')

  // 1. Igualdad exacta.
  const exact = entries.find((entry) => entry.norm === norm)
  if (exact) return { input, resolved: exact.name, matched: true, reason: 'exact' }

  // 2. Inicial + apellido.
  const abbreviated = splitAbbreviated(norm)
  if (abbreviated) {
    const hits = entries.filter(
      (entry) =>
        firstInitial(entry.norm) === abbreviated.initial &&
        surnameVariants(entry.norm).includes(abbreviated.surname),
    )
    if (hits.length === 1) {
      return { input, resolved: hits[0].name, matched: true, reason: 'initial-surname' }
    }
    if (hits.length > 1) {
      return {
        input,
        resolved: input,
        matched: false,
        reason: 'ambiguous',
        candidates: hits.map((h) => h.name),
      }
    }
  }

  // 3. Solo apellido. Vale tanto para el abreviado cuya inicial no cuadra (la
  //    API escribe el nombre de pila que no usa el jugador) como para el nombre
  //    de una sola palabra.
  const surname = abbreviated ? abbreviated.surname : norm
  const bySurname = entries.filter((entry) => surnameVariants(entry.norm).includes(surname))
  if (bySurname.length === 1) {
    return { input, resolved: bySurname[0].name, matched: true, reason: 'surname' }
  }
  if (bySurname.length > 1) {
    return {
      input,
      resolved: input,
      matched: false,
      reason: 'ambiguous',
      candidates: bySurname.map((h) => h.name),
    }
  }

  // 4. Una sola palabra contra el nombre de pila ("Vinicius" -> "Vinicius Junior").
  if (!abbreviated && !norm.includes(' ')) {
    const byGivenName = entries.filter((entry) => entry.norm.split(' ')[0] === norm)
    if (byGivenName.length === 1) {
      return { input, resolved: byGivenName[0].name, matched: true, reason: 'given-name' }
    }
    if (byGivenName.length > 1) {
      return {
        input,
        resolved: input,
        matched: false,
        reason: 'ambiguous',
        candidates: byGivenName.map((h) => h.name),
      }
    }
  }

  return { input, resolved: input, matched: false, reason: 'no-match' }
}

// ---------------------------------------------------------------------------
// Eventos: que cuenta como gol
// ---------------------------------------------------------------------------

/**
 * Tipos de evento que NO son un gol y que conocemos. Se ignoran en silencio.
 * Cualquier `type` fuera de esta lista y de los de gol se anota en el informe
 * (`unknownEventTypes`) para que se revise: es la senal de que la API ha
 * cambiado el vocabulario.
 */
const KNOWN_NON_GOAL_TYPES = new Set([
  'yellow card',
  'red card',
  'second yellow card',
  'substitution',
  'subst',
  'var',
])

/** Todo el texto del evento, en minusculas: donde buscar matices como "own goal". */
function eventText(event: HlEvent): string {
  return [event.type, event.detail, event.comment, event.description]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase()
}

/**
 * ¿Gol en propia meta?
 *
 * QUE SE HACE CON ELLOS: **no entran en `real_scorers`**. La peña pronostica
 * "quien marca", y un central que se la mete en su porteria no es el goleador
 * que nadie apunto; anotarlo repartiria puntos a quien no acerto nada. Si cuenta
 * para el marcador, claro, pero ese lo trae football-data.org, que es quien
 * manda ahi.
 *
 * Se cuentan aparte (`ownGoals`) porque hacen falta para cuadrar: un 1-0 de
 * propia meta tiene un gol en el marcador y cero goleadores, y sin ese numero la
 * comprobacion de abajo creeria que faltan datos y no cerraria el partido nunca.
 */
function isOwnGoal(text: string): boolean {
  return /own\s*goal|owngoal|autogol|en propia/.test(text)
}

/**
 * ¿Gol anulado o penalti fallado?
 *
 * QUE SE HACE CON ELLOS: **no entran en ninguna lista**. Un penalti que para el
 * portero no es un gol y quien lo tiro no es goleador. Igual con un gol anulado
 * por el VAR.
 */
function isNotAGoal(text: string): boolean {
  return /miss|saved|fail|saved|cancel|disallow|anulad|fallad|no goal/.test(text)
}

/** Clave de deduplicacion: mismo equipo, mismo minuto y mismo jugador es el mismo gol. */
function goalKey(event: HlEvent): string {
  const team = teamName(event.team) ?? ''
  const time = event.time === null || event.time === undefined ? '' : String(event.time)
  return `${team.toLowerCase()}|${time}|${normalizePlayer(event.player ?? '')}`
}

/** Un gol ya extraido, antes de resolver nombres. */
interface RawGoal {
  team: string | null
  scorer: string
  assist: string | null
}

export interface GoalExtraction {
  goals: RawGoal[]
  ownGoals: number
  /** Tipos de evento que no sabemos clasificar. Senal de cambio en la API. */
  unknownEventTypes: string[]
  /** `true` si hubo que descartar los eventos 'Penalty' por duplicar a los 'Goal'. */
  penaltiesDroppedAsDuplicates: boolean
}

/**
 * Saca los goles de la lista de eventos de un partido.
 *
 * EL PROBLEMA DE 'Penalty'
 * `type` toma valores como 'Goal', 'Yellow Card', 'Substitution' y 'Penalty', y
 * NO esta verificado si un penalti transformado llega como 'Goal', como
 * 'Penalty' o como los dos. Las tres respuestas dan resultados distintos y
 * elegir a ciegas es como no elegir.
 *
 * Asi que no se elige a ciegas: se calculan las dos lecturas posibles y decide
 * el marcador, que ese SI lo sabemos de football-data.org.
 *   - A = solo los 'Goal'
 *   - B = los 'Goal' mas los 'Penalty' (deduplicados por equipo+minuto+jugador)
 * Si B no se pasa de los goles que hay que explicar, vale B (los penaltis eran
 * goles aparte). Si se pasa, es que estaban duplicando a los 'Goal' y vale A.
 *
 * `totalGoals` son los goles del marcador (real_home + real_away); los que hay
 * que explicar con goleador son esos menos los de propia meta, que se descuentan
 * aqui dentro porque hasta recorrer los eventos no se sabe cuantos son.
 */
export function extractGoals(events: HlEvent[], totalGoals: number): GoalExtraction {
  const unknown = new Set<string>()
  let ownGoals = 0

  const plainGoals: HlEvent[] = []
  const penaltyGoals: HlEvent[] = []

  for (const event of events) {
    const text = eventText(event)
    const type = (event.type ?? '').trim().toLowerCase()

    if (isOwnGoal(text)) {
      ownGoals += 1
      continue
    }
    if (type === 'goal') {
      if (!isNotAGoal(text)) plainGoals.push(event)
      continue
    }
    if (type === 'penalty') {
      if (!isNotAGoal(text)) penaltyGoals.push(event)
      continue
    }
    if (type === '' || KNOWN_NON_GOAL_TYPES.has(type)) continue
    unknown.add(event.type ?? '(vacio)')
  }

  const dedupe = (list: HlEvent[]): HlEvent[] => {
    const seen = new Set<string>()
    const out: HlEvent[] = []
    for (const event of list) {
      const key = goalKey(event)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(event)
    }
    return out
  }

  const onlyGoals = dedupe(plainGoals)
  const withPenalties = dedupe([...plainGoals, ...penaltyGoals])

  const goalsToExplain = Math.max(totalGoals - ownGoals, 0)
  const usePenalties = withPenalties.length <= goalsToExplain
  const chosen = usePenalties ? withPenalties : onlyGoals

  const goals: RawGoal[] = chosen
    .map((event) => ({
      team: teamName(event.team),
      scorer: (event.player ?? '').trim(),
      assist: (event.assist ?? '').trim() || null,
    }))
    .filter((goal) => goal.scorer !== '')

  return {
    goals,
    ownGoals,
    unknownEventTypes: [...unknown],
    penaltiesDroppedAsDuplicates: !usePenalties && penaltyGoals.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

/** Que ha pasado con un partido concreto. Una linea por partido en el informe. */
export interface MatchOutcome {
  matchId: string
  pairing: string
  apiId: string | null
  /** `written` es el unico que toca la base. */
  status:
    | 'written'
    | 'no-goals-closed'
    | 'events-empty'
    | 'too-many-goals'
    | 'preserved-by-admin'
    | 'failed'
  scorers: string[]
  assists: string[]
  /** Goles del marcador de football-data.org. */
  realScore: string
  /** Nombres que NO casaron con la plantilla y se han guardado tal cual. */
  unmatchedNames: string[]
  note?: string
}

export interface EventsSyncReport {
  ok: boolean
  /** `true` cuando el paso no se ha ejecutado (sin clave, sin partidos, cuota). */
  skipped: boolean
  /** Mensaje cuando `ok` es false o cuando `skipped` es true. */
  error?: string
  /** `true` si el fallo es transitorio (429, 5xx, red) y merece reintento. */
  retryable?: boolean
  leagueId: string | null
  /** Partidos jugados sin goleadores que se han intentado resolver. */
  pending: number
  /** Cambios guardados en esta pasada (migracion 0025). Solo informativo. */
  subsSaved: number
  /** Peticiones gastadas en esta pasada, en total y por concepto. */
  requestsSpent: number
  requestsByKind: { matchesByDate: number; events: number }
  requestBudget: number
  /** Partidos a los que se ha escrito `real_scorers`/`real_assists`. */
  written: number
  /** Partidos cerrados sin goleadores porque acabaron 0-0. */
  closedGoalless: number
  outcomes: MatchOutcome[]
  /** Partidos nuestros que no casan con ninguno de la API. Nunca se inventan. */
  linkFailures: LinkFailure[]
  /**
   * Tasa de acierto del emparejador de nombres en esta pasada: nombres que
   * casaron con la plantilla sobre el total de nombres vistos.
   */
  nameMatch: { total: number; matched: number; ratio: number }
  /** Tipos de evento que no sabemos clasificar. Senal de cambio en la API. */
  unknownEventTypes: string[]
  warnings: string[]
  durationMs: number
}

export interface EventsSyncOptions {
  /** Liga destino. Si se omite, `SYNC_LEAGUE_ID` o la unica liga que haya. */
  leagueId?: string
  /**
   * Tope de peticiones de ESTA pasada. Por defecto 40, no 100: la cuota es
   * diaria y compartida con el resto de pasadas del dia. Ver docs/EVENTOS.md.
   */
  maxRequests?: number
  /**
   * Cuantos dias hacia atras se miran los partidos pendientes. Por defecto 8,
   * que cubre una jornada entera aunque se reparta de viernes a domingo con
   * aplazamientos. Sube esto solo para un recuperado puntual: mirar la temporada
   * entera en cada pasada gastaria la cuota en partidos que nadie va a mirar.
   */
  sinceDays?: number
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/**
 * El cron no tiene sesion y las politicas de `matches` solo dejan escribir al
 * admin `authenticated`. De ahi la service role key, que se salta RLS. NUNCA con
 * prefijo `NEXT_PUBLIC_`: acabaria en el bundle y cualquiera reescribiria goles.
 */
function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Este paso escribe en ' +
        'matches, cuya politica RLS solo admite al admin, asi que necesita la service role key.',
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

function isMissingSourceColumn(message: string): boolean {
  return /real_players_source/i.test(message)
}

function missingColumnError(message: string): Error {
  return new Error(
    'Falta la columna `matches.real_players_source`. Aplica supabase/migrations/' +
      '0012_real_players_source.sql: sin ella no hay forma de distinguir lo que metio el ' +
      `organizador a mano de lo que trae la API, y el paso se queda parado a proposito. Detalle: ${message}`,
  )
}

/** Un partido jugado que aun no tiene goleadores. */
interface PendingMatch extends LocalMatch {
  realHome: number
  realAway: number
}

// ---------------------------------------------------------------------------
// Ingesta
// ---------------------------------------------------------------------------

/** Tope por defecto de peticiones por pasada. La cuota diaria es 100. */
const DEFAULT_MAX_REQUESTS = 40
const DEFAULT_SINCE_DAYS = 8

/**
 * Guarda los cambios de un partido. PASO 1 del "Sustituto +" (migracion 0025).
 *
 * Solo MIRA: no reparte puntos ni cambia nada de lo que ya hay. Se guarda nuestra
 * interpretacion de los dos nombres Y el evento entero en `raw`, porque la forma
 * del evento NO esta verificada -- el tipo `HlEvent` dice literalmente "forma
 * documentada en el encargo y asumida aqui". Que `player` sea quien entra y
 * `substituted` quien sale es una suposicion, y montar la regla de puntos encima
 * sin comprobarlo daria los puntos al que se fue al banquillo.
 *
 * NUNCA LANZA. Esto es informacion de mas: si falla, los goleadores -- que es lo
 * que de verdad puntua -- tienen que entrar igual. El fallo viaja en `warnings`.
 *
 * Se sella `subs_fetched_at` pase lo que pase, incluso con cero cambios: un
 * partido sin ninguno no deja filas, y sin la marca se volveria a pedir en cada
 * pasada del cron para siempre.
 */
async function saveSubstitutions(
  admin: SupabaseClient,
  matchId: string,
  events: HlEvent[],
  warnings: string[],
): Promise<number> {
  const cambios = events.filter((event) => {
    const type = (event.type ?? '').trim().toLowerCase()
    return type === 'substitution' || type === 'subst'
  })

  const filas = cambios.map((event) => ({
    match_id: matchId,
    minute: event.time === null || event.time === undefined ? null : String(event.time),
    // Nombre tal cual, sin normalizar: normalizar es cosa de quien compare.
    player_in: event.player ?? null,
    player_out: event.substituted ?? null,
    team: typeof event.team === 'string' ? event.team : (event.team?.name ?? null),
    raw: event as unknown as Record<string, unknown>,
  }))

  try {
    if (filas.length > 0) {
      const { error } = await admin
        .from('match_substitutions')
        .upsert(filas, { onConflict: 'match_id,minute,player_in,player_out' })
      if (error) throw new Error(error.message)
    }
    const { error: mark } = await admin
      .from('matches')
      .update({ subs_fetched_at: new Date().toISOString() })
      .eq('id', matchId)
    if (mark) throw new Error(mark.message)
  } catch (error) {
    warnings.push(
      `${matchId}: no se pudieron guardar los cambios (${
        error instanceof Error ? error.message : String(error)
      }). Los goleadores no se ven afectados.`,
    )
    return 0
  }

  return filas.length
}

export async function syncMatchEvents(options: EventsSyncOptions = {}): Promise<EventsSyncReport> {
  const startedAt = Date.now()
  const budgetLimit = Math.max(1, options.maxRequests ?? DEFAULT_MAX_REQUESTS)
  const budget = new RequestBudget(budgetLimit)
  const warnings: string[] = []
  const outcomes: MatchOutcome[] = []
  const unknownEventTypes = new Set<string>()
  let requestsByDate = 0
  let requestsEvents = 0
  /** Cambios guardados en esta pasada. Solo informativo (paso 1 del Sustituto +). */
  let subsSaved = 0
  let namesTotal = 0
  let namesMatched = 0

  const finish = (report: Partial<EventsSyncReport>): EventsSyncReport => ({
    ok: false,
    skipped: false,
    leagueId: null,
    pending: 0,
    // Se rellena aqui y no en cada `return`: es un contador de la pasada, y en
    // los caminos de salida temprana vale 0 igualmente.
    subsSaved,
    requestsSpent: budget.spent,
    requestsByKind: { matchesByDate: requestsByDate, events: requestsEvents },
    requestBudget: budgetLimit,
    written: outcomes.filter((o) => o.status === 'written').length,
    closedGoalless: outcomes.filter((o) => o.status === 'no-goals-closed').length,
    outcomes,
    linkFailures: [],
    nameMatch: {
      total: namesTotal,
      matched: namesMatched,
      ratio: namesTotal === 0 ? 0 : Math.round((namesMatched / namesTotal) * 1000) / 1000,
    },
    unknownEventTypes: [...unknownEventTypes],
    warnings,
    durationMs: Date.now() - startedAt,
    ...report,
  })

  // INVARIANTE 2, primer escalon: sin clave el paso se SALTA con un aviso. No es
  // un error: la app funciona sin esto, el organizador mete los goleadores a mano
  // como hasta ahora, y el calendario y los marcadores no dependen de Highlightly.
  if (!isHighlightlyConfigured) {
    return finish({
      ok: true,
      skipped: true,
      error:
        'HIGHLIGHTLY_API_KEY no esta configurada: no se han traido goleadores ni asistencias. ' +
        'El calendario, los horarios y los marcadores NO dependen de esta clave y siguen ' +
        'entrando por football-data.org. Los goleadores los sigue metiendo el organizador ' +
        'desde /ajustes/admin.',
    })
  }

  let leagueId: string | null = null
  let linkFailures: LinkFailure[] = []

  try {
    const admin = createAdminClient()
    leagueId = await resolveLeagueId(admin, options.leagueId)

    // ---- 1. Partidos pendientes -------------------------------------------

    const { data: gameweeks, error: gwError } = await admin
      .from('gameweeks')
      .select('id')
      .eq('league_id', leagueId)
    if (gwError) throw new Error(`No se pudieron leer gameweeks: ${gwError.message}`)
    const gameweekIds = (gameweeks ?? []).map((row) => row.id as string)
    if (gameweekIds.length === 0) {
      return finish({ ok: true, skipped: true, leagueId, error: 'La liga no tiene jornadas todavia.' })
    }

    const sinceDays = Math.max(1, options.sinceDays ?? DEFAULT_SINCE_DAYS)
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()

    const { data: rows, error: matchError } = await admin
      .from('matches')
      .select('id, home_code, away_code, kickoff_at, real_home, real_away, real_scorers, real_assists, real_players_source')
      .in('gameweek_id', gameweekIds)
      .eq('status', 'played')
      // INVARIANTE 4: un partido que ya resolvio la API no se vuelve a consultar
      // JAMAS, ni aunque acabara 0-0 y las dos listas esten vacias.
      .neq('real_players_source', 'api')
      .gte('kickoff_at', since)
      .order('kickoff_at', { ascending: true })
    if (matchError) {
      throw isMissingSourceColumn(matchError.message)
        ? missingColumnError(matchError.message)
        : new Error(`No se pudieron leer matches: ${matchError.message}`)
    }

    // INVARIANTE 1: lo que ya escribio alguien a mano ni se consulta. Este filtro
    // ahorra peticiones; el que de verdad protege es el WHERE del UPDATE.
    const pending: PendingMatch[] = []
    for (const row of rows ?? []) {
      const scorers = (row.real_scorers as string[] | null) ?? []
      const assists = (row.real_assists as string[] | null) ?? []
      if (scorers.length > 0 || assists.length > 0) {
        outcomes.push({
          matchId: row.id as string,
          pairing: `${row.home_code}-${row.away_code}`,
          apiId: null,
          status: 'preserved-by-admin',
          scorers,
          assists,
          realScore: `${row.real_home ?? '?'}-${row.real_away ?? '?'}`,
          unmatchedNames: [],
          note: 'ya tenia goleadores o asistentes metidos a mano; no se toca ni se consulta',
        })
        continue
      }
      if (typeof row.real_home !== 'number' || typeof row.real_away !== 'number') {
        // `matches_result_complete` no deberia dejar pasar esto, pero si pasara,
        // sin marcador no hay con que cuadrar los goles: mejor saltarlo.
        warnings.push(`${row.id}: status='played' sin marcador; se salta.`)
        continue
      }
      pending.push({
        id: row.id as string,
        homeCode: row.home_code as TeamCode,
        awayCode: row.away_code as TeamCode,
        kickoffAt: row.kickoff_at as string,
        realHome: row.real_home,
        realAway: row.real_away,
      })
    }

    if (pending.length === 0) {
      return finish({
        ok: true,
        skipped: true,
        leagueId,
        pending: 0,
        error: 'No hay partidos jugados pendientes de goleadores. Cero peticiones gastadas.',
      })
    }

    // ---- 2. Plantillas, para resolver los nombres abreviados ---------------

    const { data: squadRows, error: squadError } = await admin
      .from('team_squads')
      .select('team_code, players')
      .eq('league_id', leagueId)
    if (squadError) throw new Error(`No se pudo leer team_squads: ${squadError.message}`)
    const squadByTeam = new Map<TeamCode, string[]>()
    for (const row of squadRows ?? []) {
      squadByTeam.set(row.team_code as TeamCode, (row.players as string[] | null) ?? [])
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
    const pendingById = new Map(pending.map((m) => [m.id, m]))

    // ---- 4. Eventos, uno por partido ---------------------------------------

    for (const pair of link.linked) {
      const local = pendingById.get(pair.local.id)
      if (!local) continue
      const pairing = `${local.homeCode}-${local.awayCode}`
      const realScore = `${local.realHome}-${local.realAway}`
      const totalGoals = local.realHome + local.realAway

      let events: HlEvent[]
      try {
        events = await getMatchEvents(pair.api.apiId, { budget })
        requestsEvents += 1
      } catch (error) {
        if (error instanceof BudgetExhaustedError) throw error
        if (error instanceof HighlightlyError && error.quotaExhausted) throw error
        outcomes.push({
          matchId: local.id,
          pairing,
          apiId: pair.api.apiId,
          status: 'failed',
          scorers: [],
          assists: [],
          realScore,
          unmatchedNames: [],
          note: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      // Paso 1 del Sustituto +: se guardan los cambios que acabamos de recibir.
      // No cuesta ni una peticion mas: los eventos ya estan aqui.
      subsSaved += await saveSubstitutions(admin, local.id, events, warnings)

      const extraction = extractGoals(events, totalGoals)
      for (const type of extraction.unknownEventTypes) unknownEventTypes.add(type)
      const goalsToExplain = totalGoals - extraction.ownGoals

      // Cuadre con el marcador de football-data.org, que es el que manda.
      if (extraction.goals.length > goalsToExplain) {
        outcomes.push({
          matchId: local.id,
          pairing,
          apiId: pair.api.apiId,
          status: 'too-many-goals',
          scorers: extraction.goals.map((g) => g.scorer),
          assists: [],
          realScore,
          unmatchedNames: [],
          note:
            `la API da ${extraction.goals.length} goleador(es) y el marcador dice ${goalsToExplain} ` +
            `gol(es) por explicar (${extraction.ownGoals} en propia). No se escribe nada: ` +
            'metelos a mano desde /ajustes/admin.',
        })
        continue
      }

      if (goalsToExplain === 0) {
        // No queda ningun gol que atribuir: o fue 0-0, o los goles que hubo
        // fueron todos en propia meta. Se cierra con las listas vacias y
        // `source='api'`. Si no se cerrara, esta pasada y TODAS las siguientes
        // gastarian una peticion en el mismo partido para nada, y con 100
        // peticiones al dia esa fuga se nota.
        const closed = await writePlayers(admin, local.id, [], [])
        outcomes.push({
          matchId: local.id,
          pairing,
          apiId: pair.api.apiId,
          status: closed ? 'no-goals-closed' : 'preserved-by-admin',
          scorers: [],
          assists: [],
          realScore,
          unmatchedNames: [],
          note: closed
            ? extraction.ownGoals > 0
              ? `los ${extraction.ownGoals} gol(es) fueron en propia meta: sin goleadores que anotar, ` +
                'se marca como resuelto para no volver a consultarlo'
              : 'partido sin goles: se marca como resuelto para no volver a consultarlo'
            : 'el organizador escribio algo entre la lectura y la escritura; gana el',
        })
        continue
      }

      if (extraction.goals.length === 0) {
        // Hubo goles pero la API aun no los tiene (o los da de una forma que no
        // entendemos). NO se escribe: dejarlo pendiente cuesta una peticion en la
        // siguiente pasada, y escribir vacio lo cerraria en falso para siempre.
        outcomes.push({
          matchId: local.id,
          pairing,
          apiId: pair.api.apiId,
          status: 'events-empty',
          scorers: [],
          assists: [],
          realScore,
          unmatchedNames: [],
          note:
            `${events.length} evento(s) y ningun gol reconocido para un ${realScore}. Se reintenta ` +
            'en la siguiente pasada.',
        })
        continue
      }

      // ---- 5. Nombres ------------------------------------------------------

      const unmatched: string[] = []
      const scorers: string[] = []
      const assists: string[] = []
      const seenScorer = new Set<string>()
      const seenAssist = new Set<string>()

      /** La plantilla del equipo del evento; si no se sabe, las dos juntas. */
      const squadFor = (team: string | null): string[] => {
        const home = squadByTeam.get(local.homeCode) ?? []
        const away = squadByTeam.get(local.awayCode) ?? []
        if (!team) return [...home, ...away]
        const resolved = resolveTeamSide(team, local.homeCode, local.awayCode)
        if (resolved === 'home') return home
        if (resolved === 'away') return away
        return [...home, ...away]
      }

      for (const goal of extraction.goals) {
        const squad = squadFor(goal.team)

        const scorer = resolvePlayerName(goal.scorer, squad)
        namesTotal += 1
        if (scorer.matched) namesMatched += 1
        else unmatched.push(scorer.input)
        // Se deduplica por forma normalizada, igual que `calc_points`: dos
        // grafias del mismo jugador son un solo goleador para la puntuacion, y
        // tenerlas las dos en la lista no cambia nada salvo confundir al leerla.
        const scorerKey = normalizePlayer(scorer.resolved)
        if (scorerKey !== '' && !seenScorer.has(scorerKey)) {
          seenScorer.add(scorerKey)
          scorers.push(scorer.resolved)
        }

        if (goal.assist) {
          const assist = resolvePlayerName(goal.assist, squad)
          namesTotal += 1
          if (assist.matched) namesMatched += 1
          else unmatched.push(assist.input)
          const assistKey = normalizePlayer(assist.resolved)
          if (assistKey !== '' && !seenAssist.has(assistKey)) {
            seenAssist.add(assistKey)
            assists.push(assist.resolved)
          }
        }
      }

      // ---- 6. Escritura ----------------------------------------------------

      const written = await writePlayers(admin, local.id, scorers, assists)
      const note: string[] = []
      if (extraction.ownGoals > 0) {
        note.push(`${extraction.ownGoals} gol(es) en propia meta, fuera de real_scorers a proposito`)
      }
      if (extraction.penaltiesDroppedAsDuplicates) {
        note.push("eventos 'Penalty' descartados por duplicar a los 'Goal'")
      }
      if (extraction.goals.length < goalsToExplain) {
        note.push(
          `la API solo explica ${extraction.goals.length} de ${goalsToExplain} gol(es): revisa el partido`,
        )
      }
      outcomes.push({
        matchId: local.id,
        pairing,
        apiId: pair.api.apiId,
        status: written ? 'written' : 'preserved-by-admin',
        scorers,
        assists,
        realScore,
        unmatchedNames: unmatched,
        note: written
          ? note.join('; ') || undefined
          : 'el organizador escribio entre la lectura y la escritura; gana el',
      })
    }

    if (linkFailures.length > 0) {
      warnings.push(
        `${linkFailures.length} partido(s) sin emparejar con Highlightly. NO se han inventado: ` +
          'mira `linkFailures[].apiTeamsThatDay` y completa HIGHLIGHTLY_TEAM_ALIASES en ' +
          'src/lib/highlightly/match-link.ts con el nombre literal que da la API.',
      )
    }
    if (unknownEventTypes.size > 0) {
      warnings.push(
        `Tipos de evento sin clasificar: ${[...unknownEventTypes].join(', ')}. Se han ignorado. ` +
          'Si alguno es un gol, anadelo a extractGoals() en src/lib/highlightly/events.ts.',
      )
    }
    if (namesTotal > 0 && namesMatched < namesTotal) {
      warnings.push(
        `${namesTotal - namesMatched} de ${namesTotal} nombre(s) no casaron con la plantilla y se ` +
          'han guardado abreviados. Un nombre abreviado no puntua a nadie, pero es preferible a ' +
          'puntuar al jugador equivocado. Corrigelos desde /ajustes/admin si hace falta.',
      )
    }

    return finish({ ok: true, leagueId, pending: pending.length, linkFailures })
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      // No es un fallo: se ha llegado al tope de la pasada y el resto de partidos
      // se resuelven en la siguiente. La ingesta se da por buena.
      warnings.push(error.message)
      return finish({ ok: true, leagueId, linkFailures, pending: outcomes.length })
    }
    const message = error instanceof Error ? error.message : String(error)
    const retryable = error instanceof HighlightlyError ? error.retryable : false
    return finish({ ok: false, leagueId, error: message, retryable, linkFailures })
  }
}

/**
 * Escribe los goleadores y los asistentes de un partido. Devuelve `false` si el
 * UPDATE no toco ninguna fila, que solo puede pasar por una razon: alguien
 * escribio a mano entre la lectura y esta llamada.
 *
 * Las tres condiciones del WHERE son la proteccion de la migracion 0012 y tienen
 * que evaluarse en POSTGRES, no aqui: comprobarlo en memoria dejaria abierta la
 * ventana entre la lectura y la escritura.
 */
async function writePlayers(
  admin: SupabaseClient,
  matchId: string,
  scorers: string[],
  assists: string[],
): Promise<boolean> {
  const { data, error } = await admin
    .from('matches')
    .update({ real_scorers: scorers, real_assists: assists, real_players_source: 'api' })
    .eq('id', matchId)
    .neq('real_players_source', 'api')
    .eq('real_scorers', '{}')
    .eq('real_assists', '{}')
    .select('id')
  if (error) {
    throw isMissingSourceColumn(error.message)
      ? missingColumnError(error.message)
      : new Error(`Escritura en matches fallida: ${error.message}`)
  }
  return (data?.length ?? 0) > 0
}

/**
 * ¿El nombre de equipo que trae el evento es el local o el visitante?
 *
 * Se resuelve contra los DOS codigos del partido y no contra la tabla entera de
 * alias: aqui solo puede ser uno de los dos, y limitar las opciones a dos evita
 * que un nombre raro acabe eligiendo un tercer equipo que ni siquiera juega.
 * `null` cuando no se sabe: entonces se busca en las dos plantillas.
 */
export function resolveTeamSide(name: string, home: TeamCode, away: TeamCode): 'home' | 'away' | null {
  const code = resolveHighlightlyTeam(name)
  if (code === home) return 'home'
  if (code === away) return 'away'
  return null
}
